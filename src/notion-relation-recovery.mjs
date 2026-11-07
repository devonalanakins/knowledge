/**
 * G20A: bounded read-only recovery of truncated Notion relation properties.
 * Only one explicitly selected page from a protected G18 source inventory may
 * be inspected at a time. The caller seals the returned PRIVATE metadata.
 * This does not grant permission to migrate or dereference related pages.
 */
import {createHash} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
const CURSOR=/^[A-Za-z0-9_-]{1,180}$/;
const LIMITS=Object.freeze({
  propertiesPerPage:12,requestPagesPerPage:30,itemsPerPage:1500,
  serializedBytesPerPage:2_000_000,
});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const normal=id=>String(id).replaceAll('-','').toLowerCase();
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function reject(code,message){const error=new Error(message);error.code=code;throw error;}
function requireValid(value,code,message){if(!value)reject(code,message);}

/**
 * Relations that already fit in the initial page response are preserved by
 * G19; only has_more=true properties need separate, paginated retrieval.
 *
 * The G18 relation count must agree with the live page metadata. If the source
 * inventory is stale or permission-scoped differently, no archive is produced.
 */
export async function capturePaginatedRelationProperties({
  client,source,page,enabled=false,
}={}){
  requireValid(client&&typeof client.request==='function'&&
    object(source)&&object(page)&&object(page.properties)&&
    typeof source.sourceId==='string'&&UUID.test(source.sourceId),
    'INVALID_RELATION_INPUT','Source page and read-only client are required');
  const pending=Object.entries(page.properties).filter(([,value])=>
    object(value)&&value.type==='relation'&&value.has_more===true);
  requireValid(Number.isSafeInteger(source.unresolvedRelations)&&
    source.unresolvedRelations>=0&&source.unresolvedRelations===pending.length,
    'RELATION_INVENTORY_DRIFT','Page relation pagination differs from the protected G18 inventory');
  if(!pending.length)return {relations:[],referencedIds:[],requestCount:0};
  requireValid(enabled===true,'UNRESOLVED_RELATIONS',
    'Explicit relation pagination selection is required');
  requireValid(pending.length<=LIMITS.propertiesPerPage,
    'RELATION_LIMIT_EXCEEDED','Too many paginated properties in this page');
  const relations=[],refs=new Set();
  let requests=0,itemsTotal=0,bytes=0;
  const propertyIds=new Set();
  for(const [propertyName,original] of pending){
    requireValid(typeof original.id==='string'&&
      original.id.length>0&&original.id.length<=64&&
      original.id!=='.'&&original.id!=='..'&&
      Array.isArray(original.relation),
      'INVALID_RELATION_PROPERTY','Invalid original Notion relation property');
    const propertyId=original.id;
    // Notion sometimes returns property IDs already percent-encoded.
    // Decode exactly once and re-encode canonically: never double-encode.
    let decodedPropertyId;
    try{decodedPropertyId=decodeURIComponent(propertyId);}
    catch{reject('INVALID_RELATION_PROPERTY','Notion property ID encoding is invalid')}
    requireValid(decodedPropertyId.length>0&&decodedPropertyId.length<=64&&
      decodedPropertyId!=='.'&&decodedPropertyId!=='..',
      'INVALID_RELATION_PROPERTY','Notion property ID encoding is unsafe');
    const encodedPropertyId=encodeURIComponent(decodedPropertyId);
    requireValid(!propertyIds.has(propertyId),'DUPLICATE_RELATION_PROPERTY',
      'Notion relation property ID repeated');
    propertyIds.add(propertyId);
    const originalPrefix=original.relation.map(value=>{
      requireValid(object(value)&&typeof value.id==='string'&&UUID.test(value.id),
        'INVALID_RELATION_PROPERTY','Original relation is malformed');
      return normal(value.id);
    });
    const items=[],seen=new Set(),cursors=new Set();
    let cursor=null;
    do {
      requests++;
      requireValid(requests<=LIMITS.requestPagesPerPage,
        'RELATION_LIMIT_EXCEEDED','Relation pagination request limit exceeded');
      const path='/v1/pages/'+normal(source.sourceId)+'/properties/'+
        encodedPropertyId+'?page_size=100'+
        (cursor?'&start_cursor='+cursor:'');
      const batch=await client.request(path);
      requireValid(object(batch)&&batch.object==='list'&&
        Array.isArray(batch.results)&&batch.results.length<=100&&
        typeof batch.has_more==='boolean',
        'INVALID_RELATION_RESPONSE','Invalid Notion relation item list');
      for(const value of batch.results){
        requireValid(object(value)&&value.object==='property_item'&&
          value.type==='relation'&&value.id===propertyId&&
          object(value.relation)&&UUID.test(value.relation.id||''),
          'INVALID_RELATION_RESPONSE','Notion relation item shape or identity changed');
        const id=normal(value.relation.id);
        requireValid(!seen.has(id),'DUPLICATE_RELATION_ITEM',
          'Repeated related page ID in a paginated property');
        seen.add(id);items.push(id);refs.add(id);
        itemsTotal++;
        bytes+=Buffer.byteLength(JSON.stringify(value),'utf8');
        requireValid(itemsTotal<=LIMITS.itemsPerPage&&
          bytes<=LIMITS.serializedBytesPerPage,
          'RELATION_LIMIT_EXCEEDED','Relation result exceeds protected limits');
      }
      if(batch.has_more){
        const next=batch.next_cursor;
        requireValid(typeof next==='string'&&CURSOR.test(next)&&
          !cursors.has(next)&&batch.results.length>0,
          'INVALID_RELATION_CURSOR','Notion relation cursor did not advance');
        cursors.add(next);cursor=next;
      }else cursor=null;
    }while(cursor);
    requireValid(originalPrefix.every((id,index)=>items[index]===id),
      'RELATION_SOURCE_CHANGED','Notion relation items no longer match the inventoried prefix');
    const record={propertyName,propertyId,partialCount:originalPrefix.length,
      relatedPageIds:items,complete:true};
    relations.push({...record,sha256:sha(record)});
  }
  return {relations,referencedIds:[...refs].sort(),requestCount:requests};
}

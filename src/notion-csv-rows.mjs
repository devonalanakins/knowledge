/**
 * Import Notion CSV database rows without dropping columns, multiline cells
 * or commas. Preserves the exact source CSV separately in notion_originals.
 * Values are untrusted text; no spreadsheet formulas are executed.
 */
const MAX_ROWS=100000;
const MAX_COLUMNS=256;
const MAX_CELL_CHARS=1024*1024;
function fail(code,message){const e=new Error(message);e.code=code;throw e}
function need(ok,code,message){if(!ok)fail(code,message)}
export function parseNotionDatabaseCsv(raw){
 need(typeof raw==='string'&&raw.length>0&&raw.length<=16*1024*1024,
  'INVALID_CSV','Private Notion CSV must be nonempty and bounded');
 const rows=[];let row=[],cell='',quoted=false,afterQuote=false;
 function putCell(){
  need(cell.length<=MAX_CELL_CHARS&&row.length<MAX_COLUMNS,
   'CSV_LIMIT_EXCEEDED','Notion database CSV exceeds column or cell budget');
  row.push(cell);cell='';afterQuote=false;
 }
 function putRow(){
  putCell();
  if(row.length===1&&row[0]===''){row=[];return}
  need(rows.length<MAX_ROWS,'CSV_LIMIT_EXCEEDED','Too many Notion database rows');
  rows.push(row);row=[];
 }
 for(let i=0;i<raw.length;i++){
  const ch=raw[i];
  need(ch!=='\0','INVALID_CSV','Notion CSV contains a null byte');
  if(quoted){
   if(ch==='"'){
    if(raw[i+1]==='"'){cell+='"';i++}
    else{quoted=false;afterQuote=true}
   }else cell+=ch;
  }else if(afterQuote){
   if(ch===',')putCell();
   else if(ch==='\r'||ch==='\n'){
    if(ch==='\r'&&raw[i+1]==='\n')i++;
    putRow();
   }else fail('INVALID_CSV','Unexpected text after closing CSV quote');
  }else if(ch==='"'){
   need(cell==='','INVALID_CSV','Invalid quoted field position');
   quoted=true;
  }else if(ch===',')putCell();
  else if(ch==='\r'||ch==='\n'){
   if(ch==='\r'&&raw[i+1]==='\n')i++;
   putRow();
  }else cell+=ch;
  need(cell.length<=MAX_CELL_CHARS,'CSV_LIMIT_EXCEEDED',
   'Notion database field exceeds safe import budget');
 }
 need(!quoted,'INVALID_CSV','Unterminated quoted CSV field');
 if(cell||row.length||afterQuote)putRow();
 need(rows.length>0,'INVALID_CSV','CSV missing database headers');
 const headers=rows.shift().map((name,i)=>
  i===0?name.replace(/^\uFEFF/,''):name);
 need(headers.every(x=>x.length>0&&x.length<=256)&&
  new Set(headers).size===headers.length,
  'INVALID_CSV','Notion database column headers missing or duplicated');
 const titleColumn=headers.findIndex(x=>/^(name|title|project|task)$/i.test(x.trim()));
 const titleIndex=titleColumn>=0?titleColumn:0;
 return rows.map((columns,i)=>{
  need(columns.length===headers.length,'INVALID_CSV',
   'Notion database row has a different column count');
  const fields=Object.fromEntries(headers.map((name,index)=>[name,columns[index]]));
  const title=(columns[titleIndex]?.trim()||'Untitled row '+(i+1)).slice(0,140);
  const originalJson=JSON.stringify({
   format:'knowledge-notion-original-csv-row-v1',
   rowIndex:i+1,headers,values:columns,
  });
  return {index:i+1,title,fields,originalJson};
 });
}

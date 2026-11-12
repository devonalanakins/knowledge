/** Minimal, inert Markdown-to-HTML renderer for the owner-only Knowledge reader.
 * Not an HTML sanitizer: source HTML is always escaped, never interpreted.
 * The editor keeps the exact original Markdown bytes.
 */
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function inline(text,internalLinks=true,externalLinks=true) {
  const tokens = /(`[^`\n]{1,500}`)|(\[([^\]\n]{1,160})\]\((https:\/\/[^\s)\n]{1,2048})\))|(\*\*([^*\n]{1,500})\*\*)|(\*([^*\n]{1,500})\*)|(\[\[([a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63}){0,7})(?:\|([^\]\n]{1,160}))?\]\])/g;
  let out = '', offset = 0, match;
  while ((match = tokens.exec(text)) !== null) {
    out += escapeHtml(text.slice(offset, match.index));
    if (match[1]) out += '<code>' + escapeHtml(match[1].slice(1,-1)) + '</code>';
    else if (match[2]) {
      let safe = false;
      try {
        const url = new URL(match[4]);
        safe = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
      } catch {}
      out += !externalLinks ? escapeHtml(match[3]) : safe
        ? '<a href="' + escapeHtml(match[4]) + '" rel="noopener noreferrer" target="_blank">' + escapeHtml(match[3]) + '</a>'
        : escapeHtml(match[2]);
    }
    else if (match[5]) out += '<strong>' + escapeHtml(match[6]) + '</strong>';
    else if (match[7]) out += '<em>' + escapeHtml(match[8]) + '</em>';
    else if (match[9]) {
      const path=match[10];
      out += internalLinks && path.length<=240?'<a href="/wiki/page/'+path+'" class="wiki-link">'+escapeHtml(match[11]??path)+'</a>':escapeHtml(match[11]??'Linked private record');
    }
    offset = match.index + match[0].length;
  }
  return out + escapeHtml(text.slice(offset));
}

/** Bounded pipe-table rows. Internal [[path|label]] and inline code pipes
 * are cell content, never table boundaries. Raw HTML is handled only by inline().
 */
function tableCells(line) {
  if (typeof line!=='string'||!line.includes('|')) return null;
  let text=line.trim();
  if (text.startsWith('|')) text=text.slice(1);
  if (text.endsWith('|')) {
    let slashes=0;
    for(let i=text.length-2;i>=0&&text[i]==='\\';i--) slashes++;
    if(slashes%2===0) text=text.slice(0,-1);
  }
  const cells=[];
  let cell='',code=false,wiki=false;
  for(let i=0;i<text.length;i++) {
    if(text[i]==='\\'&&text[i+1]==='|'){cell+='|';i++;continue;}
    if(!code&&text.startsWith('[[',i)){wiki=true;cell+='[[';i++;continue;}
    if(wiki&&text.startsWith(']]',i)){wiki=false;cell+=']]';i++;continue;}
    if(text.charCodeAt(i)===96&&!wiki)code=!code;
    if(text[i]==='|'&&!code&&!wiki){cells.push(cell.trim());cell='';}
    else cell+=text[i];
    if(cells.length>24)return null;
  }
  cells.push(cell.trim());
  return cells.length<=24?cells:null;
}
function tableAlignment(separator) {
  if(!/^:?-{3,}:?$/.test(separator))return null;
  return separator.startsWith(':')&&separator.endsWith(':')?'center':
    separator.endsWith(':')?'right':separator.startsWith(':')?'left':'';
}

export function renderSafeMarkdown(source,{internalLinks=true,externalLinks=true}={}) {
  if (typeof source !== 'string') throw new TypeError('KNOWLEDGE_MARKDOWN_INVALID');
  const lines = source.replace(/\r\n?/g,'\n').split('\n');
  const blocks = [];
  let paragraph = [], items = [], kind = null, quote = [], code = [], fenced = false;
  function flushParagraph() {
    if (paragraph.length) {blocks.push('<p>' + inline(paragraph.join(' '),internalLinks,externalLinks) + '</p>');paragraph=[];}
  }
  function flushItems() {
    if (items.length) {blocks.push('<' + kind + '>' + items.map(x=>'<li>'+inline(x,internalLinks,externalLinks)+'</li>').join('')+'</'+kind+'>');items=[];kind=null;}
  }
  function flushQuote() {
    if (quote.length) {blocks.push('<blockquote><p>'+inline(quote.join(' '),internalLinks,externalLinks)+'</p></blockquote>');quote=[];}
  }
  for (let index=0;index<lines.length;index++) {
    const line=lines[index];
    if(!fenced&&index+1<lines.length) {
      const headers=tableCells(line),separators=tableCells(lines[index+1]);
      const aligns=separators?.map(tableAlignment);
      if(headers&&separators&&headers.length===separators.length&&
        aligns.every(value=>value!==null)) {
        flushParagraph();flushItems();flushQuote();
        const cells=(row,tag)=>row.map((value,i)=>'<'+tag+
          (tag==='th'?' scope="col"':'')+
          (aligns[i]?' class="align-'+aligns[i]+'"':'')+'>'+
          inline(value,internalLinks,externalLinks)+'</'+tag+'>').join('');
        const body=[];
        let next=index+2;
        while(next<lines.length) {
          const row=tableCells(lines[next]);
          if(!row||row.length!==headers.length)break;
          body.push('<tr>'+cells(row,'td')+'</tr>');next++;
        }
        blocks.push('<div class="document-table-scroll" role="region" aria-label="Document table" tabindex="0">'+
          '<table><thead><tr>'+cells(headers,'th')+'</tr></thead><tbody>'+body.join('')+
          '</tbody></table></div>');
        index=next-1;
        continue;
      }
    }
    if (/^\s*```/.test(line)) {
      flushParagraph();flushItems();flushQuote();
      if (fenced) {blocks.push('<pre><code>'+escapeHtml(code.join('\n'))+'</code></pre>');code=[];}
      fenced = !fenced;continue;
    }
    if (fenced) {code.push(line);continue;}
    if (!line.trim()) {flushParagraph();flushItems();flushQuote();continue;}
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();flushItems();flushQuote();
      const level=Math.min(5,heading[1].length+1); // Record title is already the only h1.
      blocks.push('<h'+level+'>'+inline(heading[2],internalLinks,externalLinks)+'</h'+level+'>');continue;
    }
    if (/^\s*(?:---+|___+)\s*$/.test(line)) {
      flushParagraph();flushItems();flushQuote();blocks.push('<hr>');continue;
    }
    const item = /^\s{0,3}(-|\*|\d+\.)\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();flushQuote();
      const type=/^\d/.test(item[1])?'ol':'ul';
      if(kind&&kind!==type)flushItems();
      kind=type;items.push(item[2]);continue;
    }
    const quotation=/^>\s?(.*)$/.exec(line);
    if (quotation) {flushParagraph();flushItems();quote.push(quotation[1]);continue;}
    flushItems();flushQuote();paragraph.push(line.trim());
  }
  if (fenced) blocks.push('<pre><code>'+escapeHtml(code.join('\n'))+'</code></pre>');
  flushParagraph();flushItems();flushQuote();
  return blocks.join('\n') || '<p class="empty">This record has no content yet.</p>';
}

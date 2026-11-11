/** Inline, self-contained identity symbol for independent Knowledge product. */
export function neuralKMark(){
  return '<svg class="neural-k" viewBox="0 0 64 64" role="img" aria-label="Knowledge branching K" xmlns="http://www.w3.org/2000/svg">'+
  '<defs><linearGradient id="knowledge-mark-gradient" x1="0" y1="0" x2="1" y2="1">'+
  '<stop offset="0" stop-color="#b4ffe0"/><stop offset=".54" stop-color="#75eac5"/><stop offset="1" stop-color="#38b4a3"/></linearGradient></defs>'+
  '<path d="M17 11V53" fill="none" stroke="url(#knowledge-mark-gradient)" stroke-width="7.5" stroke-linecap="round"/>'+
  '<path d="M21 33C31 30 36 20 47 14M24 33C36 33 42 32 48 31M22 34C31 39 38 46 48 52" '+
  'fill="none" stroke="url(#knowledge-mark-gradient)" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/>'+
  '<circle cx="49" cy="13" r="4.4" fill="#9df8d4"/><circle cx="50" cy="31" r="4.1" fill="#87edca"/>'+
  '<circle cx="50" cy="53" r="4.8" fill="#4cc6ae"/></svg>';
}
const SHAPES={
  home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  search:'<circle cx="10.6" cy="10.6" r="6.6"/><path d="m16 16 5 5"/>',
  folder:'<path d="M3 6h6l2 3h10v11H3z"/>',
  file:'<path d="M5 2h9l5 5v15H5z"/><path d="M14 2v5h5M8 12h8M8 16h8"/>',
  history:'<path d="M3 11a9 9 0 1 1 2 6M3 4v7h7"/><path d="M12 7v5l3 2"/>',
  lock:'<rect x="5" y="11" width="14" height="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shared:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 11 6-5M9 13l6 5"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  layers:'<path d="m12 2 10 6-10 6L2 8z"/><path d="m2 12 10 6 10-6M2 16l10 6 10-6"/>',
  shield:'<path d="m12 2 9 4v6c0 6-4 9-9 10-5-1-9-4-9-10V6z"/><path d="m9 12 2 2 4-4"/>',
  edit:'<path d="m4 20 4.5-.8L20 7.7 16.3 4 4.8 15.5z"/><path d="M14.5 6 18 9.5"/>',
  back:'<path d="m14 5-7 7 7 7"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/>'
};
export function uiGlyph(name){
  const shape=SHAPES[name]??SHAPES.file;
  return '<svg class="ui-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+shape+'</svg>';
}

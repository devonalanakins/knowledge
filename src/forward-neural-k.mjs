/** Knowledge primary logo geometry derived from the owner-approved 2026-11-11 brand board.
 * The previous thin-stroke approximation is SUPERSEDED. This is one organic, filled K:
 * broad rounded trunk, flowing upper/middle/lower branches and three terminal nodes.
 * Source image SHA256: bc476401fdbdd171fce0756f5e416d6c7fd84bfed23015a4dfcc829f1f016cc7
 * Geometry SHA256: 2bfff0621e102904b330d4eb69435617bcf19629659b3da1d943e04b6d9665a7
 */
export const KNOWLEDGE_NEURAL_K_LOCKED_PATH="M580.0 130.5 Q573 123 561.0 119.5 Q549 116 537.5 120.0 Q526 124 518.5 133.5 Q511 143 509.5 156.0 Q508 169 499.5 177.5 Q491 186 443.5 215.0 Q396 244 383.0 256.0 Q370 268 357.0 286.5 Q344 305 329.0 321.5 Q314 338 306.0 344.0 Q298 350 281.5 356.5 Q265 363 259.0 360.5 Q253 358 252.0 259.5 Q251 161 243.0 150.5 Q235 140 225.0 136.0 Q215 132 203.0 133.0 Q191 134 180.5 142.0 Q170 150 166.0 159.0 Q162 168 162.0 403.0 Q162 638 164.0 644.0 Q166 650 172.5 657.5 Q179 665 187.0 669.0 Q195 673 207.5 673.0 Q220 673 228.0 669.0 Q236 665 243.5 654.5 Q251 644 252.0 557.0 Q253 470 259.5 464.5 Q266 459 276.5 459.0 Q287 459 303.0 463.0 Q319 467 340.0 479.0 Q361 491 406.5 544.0 Q452 597 477.5 619.0 Q503 641 518.0 649.0 Q533 657 543.0 659.5 Q553 662 563.5 660.5 Q574 659 585.0 650.5 Q596 642 600.5 631.0 Q605 620 605.0 611.5 Q605 603 597.0 589.5 Q589 576 575.0 570.0 Q561 564 544.0 567.0 Q527 570 515.5 565.0 Q504 560 488.5 546.0 Q473 532 449.0 503.5 Q425 475 409.0 459.5 Q393 444 380.0 435.0 Q367 426 343.0 416.0 Q319 406 334.5 395.5 Q350 385 369.5 379.0 Q389 373 409.5 371.0 Q430 369 458.5 371.0 Q487 373 499.0 380.5 Q511 388 522.0 386.5 Q533 385 540.0 379.0 Q547 373 550.0 366.5 Q553 360 552.0 349.0 Q551 338 545.5 331.0 Q540 324 530.0 320.0 Q520 316 509.5 319.0 Q499 322 490.5 333.0 Q482 344 475.0 346.5 Q468 349 432.5 349.0 Q397 349 390.5 347.5 Q384 346 382.5 343.0 Q381 340 398.0 310.5 Q415 281 441.5 257.0 Q468 233 493.0 216.0 Q518 199 524.0 197.0 Q530 195 544.0 196.5 Q558 198 569.5 191.5 Q581 185 585.5 177.0 Q590 169 590.5 159.5 Q591 150 589.0 144.0 Q587 138 580.0 130.5 Z";
export function neuralKMark(){
  return '<svg class="neural-k" viewBox="100 90 550 620" role="img" aria-label="Knowledge branching K" data-locked-mark="knowledge-neural-k-2026-11-11" xmlns="http://www.w3.org/2000/svg">'+
    '<defs><linearGradient id="knowledge-mark-gradient" x1="4%" y1="4%" x2="85%" y2="100%">'+
    '<stop offset="0" stop-color="#a4ffd8"/><stop offset=".38" stop-color="#81f4ca"/>'+
    '<stop offset=".67" stop-color="#57d7b4"/><stop offset="1" stop-color="#26aca2"/></linearGradient></defs>'+
    '<path d="'+KNOWLEDGE_NEURAL_K_LOCKED_PATH+'" fill="url(#knowledge-mark-gradient)"/></svg>';
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

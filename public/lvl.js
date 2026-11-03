function lvlColor(l){return l===1?"#eeeeee":l<=3?"#1ce400":l<=7?"#ffc800":l<=9?"#ff6309":"#fe1f00"}
function lvlSvg(l){
 l=Math.min(10,Math.max(1,parseInt(l)||1));var c=lvlColor(l);
 return '<circle cx="22" cy="22" r="19" fill="none" stroke="#3a3860" stroke-width="4"/>'+
 '<circle cx="22" cy="22" r="19" fill="none" stroke="'+c+'" stroke-width="4" stroke-linecap="round" stroke-dasharray="'+(119*l/10)+' 200" transform="rotate(-90 22 22)"/>'+
 '<text x="22" y="28" text-anchor="middle" font-family="Unbounded,sans-serif" font-weight="800" font-size="'+(l===10?15:18)+'" fill="'+c+'">'+l+'</text>';
}

// Reconstruct visual rows, independent of the PDF drawing/content-stream order.
// A tab denotes a real horizontal gap between cells, not a PDF text fragment.
export function pdfPageText(items){
 const fragments=items.filter(item=>typeof item.str==='string'&&item.str.trim()&&item.transform?.length>=6)
  .map(item=>({text:item.str.replace(/[\r\n]+/gu,' ').replace(/\u00a0/gu,' '),x:item.transform[4],y:item.transform[5],width:item.width||0,height:Math.abs(item.height||item.transform[3]||8)}))
  .sort((a,b)=>b.y-a.y||a.x-b.x);
 const rows=[];
 for(const item of fragments){
  const previous=rows.at(-1),tolerance=Math.min(3,Math.max(1,Math.min(item.height,previous?.height||item.height)*0.3));
  if(previous&&Math.abs(previous.y-item.y)<=tolerance)previous.items.push(item);
  else rows.push({y:item.y,height:item.height,items:[item]});
 }
 return rows.map(row=>{
  const ordered=row.items.sort((a,b)=>a.x-b.x);let text='',right=null;
  for(const item of ordered){
   const gap=right===null?0:item.x-right;
   const separator=right===null?'':gap>Math.max(10,item.height*1.4)?'\t':gap>Math.max(0.5,item.height*0.12)?' ':'';
   text+=separator+item.text;right=Math.max(right??0,item.x+item.width);
  }
  return text.trim();
 }).filter(Boolean).join('\n');
}

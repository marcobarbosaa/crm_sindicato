import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRAND_PATHS, createBrandGeometry } from './brand-geometry.ts';

const svg = readFileSync(new URL('../../../public/branding/conecta-core-simbolo.svg', import.meta.url), 'utf8');
const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map(match => {
  const tokens = match[1].match(/[a-zA-Z]|-?\d+(?:\.\d+)?/g);
  let i=0, command='', x=0, y=0;
  const result=[];
  while(i<tokens.length) {
    if(/[a-zA-Z]/.test(tokens[i])) command=tokens[i++];
    if(command==='v') y+=Number(tokens[i++]);
    else {
      const a=Number(tokens[i++]),b=Number(tokens[i++]);
      if(command===command.toLowerCase()) { x+=a; y+=b; }
      else { x=a;y=b; }
    }
    result.push([x,y]);
  }
  return result;
});
assert.deepEqual(paths,BRAND_PATHS,'The model must follow the official SVG centerlines');
assert.equal((svg.match(/stroke-width="30"/g)||[]).length,2);
let triangles=0;
for(const path of BRAND_PATHS) {
  const geometry=createBrandGeometry(path);
  const positions=geometry.getAttribute('position');
  const normals=geometry.getAttribute('normal');
  assert.ok([...positions.array,...normals.array].every(Number.isFinite));
  assert.ok(geometry.boundingBox.max.z-geometry.boundingBox.min.z>20,'True extruded depth');
  assert.ok(geometry.boundingBox.min.x>=-75 && geometry.boundingBox.max.x<=75);
  assert.ok(geometry.boundingBox.min.y>=-100 && geometry.boundingBox.max.y<=100);
  triangles+=positions.count/3;
  geometry.dispose();
}
assert.ok(triangles<5000,'Bounded mesh budget');
console.log(JSON.stringify({officialPaths:true,depth:true,triangles}));

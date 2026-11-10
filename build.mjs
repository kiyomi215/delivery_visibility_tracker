import fs from 'node:fs/promises';
const [html,js,seed,worker]=await Promise.all(['web/index.html','web/app.js','web/releases.json','worker/index.mjs'].map(path=>fs.readFile(path,'utf8')));
await fs.mkdir('dist/server',{recursive:true});
await fs.writeFile('dist/server/index.js', 'const html='+JSON.stringify(html)+';\nconst script='+JSON.stringify(js)+';\nconst seed='+seed+';\n'+worker);


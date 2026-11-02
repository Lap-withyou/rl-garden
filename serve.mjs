import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),base=path.join(root,'dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname),file=name==='/offline.html'?path.join(root,'学会下一步_强化学习互动指南.html'):path.resolve(base,'.'+(name==='/'?'/index.html':name));
 if(file!==path.join(root,'学会下一步_强化学习互动指南.html')&&!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return}
 const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 }catch{res.writeHead(404);res.end('Not found')}
});
server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));

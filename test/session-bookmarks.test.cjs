const test=require('node:test');
const assert=require('node:assert/strict');
const {PixivClient}=require('../src/pixiv.cjs');
const {Library}=require('../src/library.cjs');
// Electron's session.fetch follows redirects itself and exposes the final address as response.url.
const at=(url,body,init)=>Object.defineProperty(new Response(body,init),'url',{value:url});
const globalData=`<meta name="global-data" content='{"token":"token","userData":{"id":"7","name":"Test"}}'>`;
test('login follows redirects natively with the same session and reads the authenticated page',async()=>{
 const calls=[];const session={cookies:{get:async()=>[{name:'PHPSESSID',value:'7_abcdef'}]},fetch:async(url,opts)=>{calls.push({url,opts});return at('https://www.pixiv.net/zh/',globalData);}};
 const client=new PixivClient(session);const changes=[];client.onAccountChange=(a,b)=>changes.push([a,b]);
 assert.equal((await client.status()).id,'7');assert.equal(client.csrf,'token');assert.equal(calls.length,1);
 assert.ok(calls.every(c=>c.opts.credentials==='include'&&c.opts.redirect==='follow'));assert.deepEqual(changes,[[null,'7']]);
});
test('redirects that end outside Pixiv are rejected; the login host asks for verification',async()=>{
 const client=new PixivClient({fetch:async()=>at('https://other.example/','x')});
 await assert.rejects(client.fetch('https://www.pixiv.net/'),/不受信任/);
 client.session.fetch=async()=>at('https://accounts.pixiv.net/login','x');await assert.rejects(client.fetch('https://www.pixiv.net/'),/重新登录/);
 client.session.fetch=async()=>at('https://evil.example/a.png','x',{headers:{'content-type':'image/png'}});await assert.rejects(client.fetch('https://i.pximg.net/a.png',{image:true}),/不受信任/);
});
test('an unparseable home page falls back to the user id carried by the session cookie',async()=>{
 const session={cookies:{get:async()=>[{name:'PHPSESSID',value:'12345_AbCdEf'}]},fetch:async url=>url.startsWith('https://www.pixiv.net/ajax/user/12345')?Response.json({error:false,body:{name:'Cookie User',premium:true,imageBig:'https://i.pximg.net/a.png'}}):new Response('<html>new layout</html>')};
 const client=new PixivClient(session);const account=await client.status();
 assert.deepEqual(account,{id:'12345',name:'Cookie User',premium:true,avatar:'https://i.pximg.net/a.png'});assert.equal(client.csrf,'');
});
test('a guest session is reported as signed out instead of an error',async()=>{
 const client=new PixivClient({cookies:{get:async()=>[{name:'PHPSESSID',value:'guestvalue'}]},fetch:async()=>new Response('<html></html>')});
 assert.equal(await client.status(),null);
});
test('when requests cannot reach Pixiv, the signed-in browser page confirms the account and token',async()=>{
 let probes=0;const client=new PixivClient({cookies:{get:async()=>[{name:'PHPSESSID',value:'x'}]},fetch:async()=>{throw new Error('net::ERR_CONNECTION_RESET');}});
 client.probe=async()=>{probes++;return {html:globalData};};
 assert.equal((await client.status()).id,'7');assert.equal(client.csrf,'token');assert.equal(probes,1);
 await assert.rejects(new PixivClient({cookies:{get:async()=>[{name:'PHPSESSID',value:'x'}]},fetch:async()=>{throw new Error('net::ERR_CONNECTION_RESET');}}).status(),/无法连接 Pixiv/);
 const polling=new PixivClient(client.session);polling.probe=async()=>{probes++;return {html:globalData};};await assert.rejects(polling.status({probe:false}),/无法连接/);assert.equal(probes,1);
});
test('the login window snapshot is adopted directly',()=>{
 const client=new PixivClient({});assert.equal(client.adoptPage(globalData).id,'7');assert.equal(client.csrf,'token');assert.equal(client.adoptPage('<html></html>'),null);assert.equal(client.account.id,'7');
});
test('image mirror routes only i.pximg.net and auto mode falls back after a network failure',async()=>{
 const seen=[];let officialDown=true;
 const client=new PixivClient({fetch:async url=>{seen.push(new URL(url).hostname);if(officialDown&&url.startsWith('https://i.pximg.net/'))throw new Error('net::ERR_CONNECTION_TIMED_OUT');return new Response('img',{headers:{'content-type':'image/jpeg'}});}});
 await assert.rejects(client.fetch('https://i.pximg.net/a.jpg',{image:true}),/图片服务器/);assert.deepEqual(seen,['i.pximg.net']);
 client.setImageMirror({mode:'auto',host:'i.pixiv.re'});seen.length=0;await client.fetch('https://i.pximg.net/a.jpg',{image:true});assert.deepEqual(seen,['i.pximg.net','i.pixiv.re']);
 seen.length=0;await client.fetch('https://i.pximg.net/b.jpg',{image:true});assert.deepEqual(seen,['i.pixiv.re']);
 client.setImageMirror({mode:'mirror',host:'https://I.Pixiv.RE/'});seen.length=0;await client.fetch('https://s.pximg.net/c.jpg',{image:true});await client.fetch('https://i.pximg.net/c.jpg',{image:true});assert.deepEqual(seen,['s.pximg.net','i.pixiv.re']);
 for(const host of ['www.pixiv.net','127.0.0.1','localhost','evil.com/path','a']) assert.throws(()=>client.setImageMirror({mode:'mirror',host}),/域名/);
 assert.throws(()=>client.setImageMirror({mode:'proxy'}),/无效/);
});
test('logout clears cached account and CSRF when no session cookie remains',async()=>{
 const client=new PixivClient({cookies:{get:async()=>[]}});client.account={id:'7'};client.csrf='old';assert.equal(await client.status(),null);assert.equal(client.csrf,'');
});
function fixture(){const writes=[];let current={bookmarkData:null};const client={account:{id:'7'},csrf:'test',artistCache:new Map(),api:async()=>current,session:{fetch:async(url,opts)=>{writes.push({url,opts});return Response.json({error:false,body:{last_bookmark_id:'55'}});}}};return {client,writes,lib:new Library(client),set:value=>current=value};}
test('quick save does not require bookmark tags for a first bookmark',async()=>{
 const f=fixture();const result=await f.lib.quickBookmark('8');assert.equal(f.writes.length,1);assert.deepEqual(JSON.parse(f.writes[0].opts.body),{illust_id:'8',restrict:0,comment:'',tags:[]});assert.equal(result.bookmarkData.id,'55');assert.ok(f.lib.dates['7:8']);
});
test('quick save preserves existing private bookmarks and their classification without posting',async()=>{
 const f=fixture();f.set({bookmarkData:{id:'55',private:true}});const result=await f.lib.quickBookmark('8');assert.equal(f.writes.length,0);assert.equal(result.alreadySaved,true);assert.equal(result.bookmarkData.private,true);
});
test('unknown bookmark state does not overwrite possibly existing tags',async()=>{
 const f=fixture();f.set({});await assert.rejects(f.lib.quickBookmark('8'),/无法确认/);assert.equal(f.writes.length,0);
});
test('removing a bookmark posts the bookmark id as a form and a redirect is reported as re-verification',async()=>{
 const f=fixture();f.set({bookmarkData:{id:'55'}});await f.lib.removeBookmark('8');assert.equal(f.writes[0].url,'https://www.pixiv.net/ajax/illusts/bookmarks/delete');assert.equal(f.writes[0].opts.body,'bookmark_id=55');assert.equal(f.writes[0].opts.headers['Content-Type'],'application/x-www-form-urlencoded');
 f.client.session.fetch=async()=>{throw new Error("Attempted to redirect, but redirect policy was 'error'");};await assert.rejects(f.lib.removeBookmark('8'),/重新验证/);
});
test('a missing write token is fetched once through the client before posting',async()=>{
 const f=fixture();f.client.csrf='';f.client.ensureToken=async()=>{f.client.csrf='fresh';return 'fresh';};await f.lib.quickBookmark('8');assert.equal(f.writes[0].opts.headers['x-csrf-token'],'fresh');
});
test('follow and unfollow use authenticated form writes and avoid changing existing follows',async()=>{
 const f=fixture();f.set({isFollowed:false});await f.lib.follow({id:'8',follow:true});assert.equal(f.writes[0].url,'https://www.pixiv.net/bookmark_add.php');assert.equal(new URLSearchParams(f.writes[0].opts.body).get('restrict'),'0');assert.equal(f.writes[0].opts.headers['x-csrf-token'],'test');
 f.set({isFollowed:true});await f.lib.follow({id:'8',follow:true});assert.equal(f.writes.length,1);await f.lib.follow({id:'8',follow:false});assert.equal(f.writes[1].url,'https://www.pixiv.net/rpc_group_setting.php');assert.equal(new URLSearchParams(f.writes[1].opts.body).get('id'),'8');
 await assert.rejects(f.lib.follow({id:'7'}),/自己/);
});
test('failed quick saves are not retried and do not record a successful date',async()=>{
 const f=fixture();let attempts=0;f.client.session.fetch=async()=>{attempts++;throw new Error('network');};await assert.rejects(f.lib.quickBookmark('8'),/network/);assert.equal(attempts,1);assert.equal(f.lib.dates['7:8'],undefined);
});
test('official related work order and continuation IDs are preserved',async()=>{
 const client=new PixivClient({});const calls=[];client.api=async(route,params)=>{calls.push({route,params});return {illusts:[{id:'3'},{isAdContainer:true},{id:'2'}],nextIds:['4','5','bad']};};
 const result=await client.related('1');assert.deepEqual(result.works.map(w=>w.id),['3','2']);assert.deepEqual(result.nextIds,['4','5']);await client.related('1',result.nextIds);assert.deepEqual(calls[1],{route:'illust/recommend/illusts',params:{'illust_ids[]':['4','5']}});
});
test('the signed-in user id is found even when a guest PHPSESSID comes first',async()=>{
 const session={cookies:{get:async()=>[{name:'PHPSESSID',value:'fa42291f4dcce10633e53d41c1cbe898'},{name:'PHPSESSID',value:'321_AbC'}]},fetch:async url=>url.includes('/ajax/user/321')?Response.json({error:false,body:{name:'Me'}}):new Response('<html></html>')};
 assert.equal((await new PixivClient(session).status()).id,'321');
});

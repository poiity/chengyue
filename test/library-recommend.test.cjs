const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {Library,filterBookmarks}=require('../src/library.cjs');
const {TasteMemory,Recommendations,rankCandidates}=require('../src/recommend.cjs');
const {csrfFromHtml,normalizeWork}=require('../src/core.cjs');
const {PixivClient}=require('../src/pixiv.cjs');
test('all four artwork search scopes preserve AND query text',async()=>{
  const seen=[];const client=new PixivClient({fetch:async(url)=>{seen.push(new URL(url));return Response.json({error:false,body:{illustManga:{data:[],total:0}}});}});
  for(const match of ['s_tag','s_tag_full','s_tc','s_tag_tc'])await client.search({query:'風景 夜景',match});
  assert.deepEqual(seen.map(u=>u.searchParams.get('s_mode')),['s_tag','s_tag_full','s_tc','s_tag_tc']);
  assert.ok(seen.every(u=>decodeURIComponent(u.pathname).endsWith('風景 夜景')));
});
test('tag suggestions normalize Japanese tags and translated labels',async()=>{
  let requested;
  const lib=new Library({fetch:async url=>{requested=url;return Response.json({candidates:[{tag_name:'初音ミク',tag_translation:'Hatsune Miku'}]});}});
  assert.deepEqual(await lib.suggestions('miku'),[{tag:'初音ミク',translation:'Hatsune Miku'}]);assert.ok(requested.includes('keyword=miku'));
});
test('following groups and private filter are sent to own account route',async()=>{
  let route,params;const lib=new Library({account:{id:'7'},api:async(r,p)=>{route=r;params=p;return {total:30,followUserTags:['风景',{tag:'人物'}],users:[{userId:'8',userName:'A'}]};}});
  const result=await lib.following({tag:'风景',rest:'hide',page:2});
  assert.equal(route,'user/7/following');assert.equal(params.tag,'风景');assert.equal(params.rest,'hide');assert.equal(params.offset,24);assert.deepEqual(result.tags,['风景','人物']);
});
test('bookmark filters combine artwork tags and age limits',()=>{
  const works=[{id:'1',xRestrict:0,tags:['風景','夜景']},{id:'2',xRestrict:1,tags:['風景']},{id:'3',xRestrict:0,tags:['昼']}];
  assert.deepEqual(filterBookmarks(works,{artworkTag:'風景 夜景',age:'safe'}).map(w=>w.id),['1']);
  assert.deepEqual(filterBookmarks(works,{age:'r18'}).map(w=>w.id),['2']);
});
test('bookmark combinations index all pages and do not filter only the visible page',async()=>{
  const requests=[];
  const lib=new Library({account:{id:'7'},api:async(route,p)=>{requests.push(p);const count=p.offset===0?100:5;return {total:105,works:Array.from({length:count},(_,i)=>({id:String(p.offset+i+1),title:'art',tags:p.offset+i===104?['needle']:[],bookmarkData:{id:String(1000+i)},xRestrict:0}))};}});
  const result=await lib.bookmarks({artworkTag:'needle'});assert.equal(result.total,1);assert.equal(result.works[0].id,'105');assert.equal(result.indexed,105);
  await lib.bookmarks({artworkTag:'needle'});assert.equal(requests.length,2);
});
test('bookmark oldest order is based on server bookmark ordering, not work ID',async()=>{
  const lib=new Library({account:{id:'7'},api:async()=>({total:3,works:[{id:'7'},{id:'100'},{id:'2'}]})});
  assert.deepEqual((await lib.bookmarks({order:'oldest'})).works.map(w=>w.id),['2','100','7']);
});
test('CSRF parser reads current and legacy page structures',()=>{
  assert.equal(csrfFromHtml('<meta id="meta-global-data" content="{&quot;token&quot;:&quot;abc&quot;}">'),'abc');
  const body={props:{pageProps:{serverSerializedPreloadedState:JSON.stringify({api:{token:'xyz'}})}}};
  assert.equal(csrfFromHtml(`<script id="__NEXT_DATA__">${JSON.stringify(body)}</script>`),'xyz');
});
test('bookmark writes carry the CSRF token; privacy changes use edit_restrict and keep tags',async()=>{
  const writes=[];const dates={};let saved;
  const client={account:{id:'7'},csrf:'test-csrf',api:async()=>({bookmarkData:null}),session:{fetch:async(url,options)=>{writes.push({url,options});return Response.json({error:false,body:{last_bookmark_id:'40'}});}}};
  const lib=new Library(client,dates,d=>saved=d);
  await lib.quickBookmark('8');
  assert.equal(writes.length,1);assert.equal(writes[0].options.headers['x-csrf-token'],'test-csrf');
  assert.deepEqual(JSON.parse(writes[0].options.body),{illust_id:'8',restrict:0,comment:'',tags:[]});assert.ok(saved['7:8']);
  client.api=async()=>({bookmarkData:{id:'40',private:false}});
  assert.deepEqual(await lib.setBookmarkPrivacy({id:'8',private:true}),{bookmarkData:{id:'40',private:true}});
  assert.equal(writes[1].url,'https://www.pixiv.net/ajax/illusts/bookmarks/edit_restrict');assert.deepEqual(JSON.parse(writes[1].options.body),{bookmarkIds:['40'],bookmarkRestrict:'private'});
  await lib.setBookmarkPrivacy({id:'8',private:false});assert.equal(writes.length,2,'no write when privacy is unchanged');
  client.api=async()=>({bookmarkData:{id:'40',private:true}});
  await lib.removeBookmark('8');assert.equal(writes[2].options.body,'bookmark_id=40');assert.equal(saved['7:8'],undefined);
});
test('failed writes are not auto-retried and existing bookmark dates are preserved',async()=>{
  let attempts=0;const client={account:{id:'7'},csrf:'t',api:async()=>({bookmarkData:{id:'40'}}),session:{fetch:async()=>{attempts++;throw new Error('network interruption');}}};
  const lib=new Library(client,{'7:8':'2020-01-01'});
  await assert.rejects(lib.setBookmarkPrivacy({id:'8',private:true}),/network/);assert.equal(attempts,1);assert.equal(lib.dates['7:8'],'2020-01-01');
});
test('bookmark APIs reject logged out access and invalid inputs',async()=>{
  const lib=new Library({account:null});await assert.rejects(lib.bookmarks(),/登录/);await assert.rejects(lib.following(),/登录/);
  lib.client.account={id:'7'};await assert.rejects(lib.setBookmarkPrivacy({id:'8',private:'yes'}),/公开范围/);
  await assert.rejects(lib.bookmarks({bm:'2026-13'}),/月份/);
});
function memoryFixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pixiv-v2-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'taste.json');}
test('history is memory-only, deduplicated, bounded and isolated between accounts',t=>{
  const file=memoryFixture(t),m=new TasteMemory(file);m.switchAccount('7');
  m.record({id:'1',tags:['風景'],pages:[{url:'private'}],title:'First'});m.record({id:'2',tags:['風景'],title:'Second'});m.record({id:'1',tags:['風景'],title:'First'});
  assert.deepEqual(m.historyList().map(w=>w.id),['1','2']);assert.equal(m.historyList()[0].pages,undefined);
  assert.equal(m.interests()[0].weight<=2,true);assert.ok(!fs.readFileSync(file,'utf8').includes('First'));
  const restarted=new TasteMemory(file);assert.equal(restarted.historyList().length,0);restarted.switchAccount('7');assert.equal(restarted.interests()[0].tag,'風景');
  m.switchAccount('8');assert.equal(m.historyList().length,0);assert.equal(m.interests().length,0);
});
test('recommendations remove saved, seen, unknown-state and age-restricted works',()=>{
  const base={userId:'1',bookmarkKnown:true,bookmarkData:null,xRestrict:0,tags:['風景']};
  const works=[{...base,id:'a'},{...base,id:'b',bookmarkData:{id:'bookmark'}},{...base,id:'c',xRestrict:1},{...base,id:'d',xRestrict:2},{...base,id:'e',bookmarkKnown:false},{...base,id:'f'}];
  assert.deepEqual(rankCandidates(works,[{tag:'風景',weight:4}],{seen:new Set(['f'])}).map(w=>w.id),['a']);
  assert.deepEqual(rankCandidates(works,[],{allowR18:true,seen:new Set(['f'])}).map(w=>w.id),['a','c']);
});
test('recommendations score interest tags, explain their source and diversify artists',()=>{
  const works=Array.from({length:10},(_,i)=>({id:String(i),userId:i<6?'1':String(i),bookmarkKnown:true,bookmarkData:null,xRestrict:0,tags:i<6?['風景']:[],hot:i===9}));
  const chosen=rankCandidates(works,[{tag:'風景',weight:4}]);assert.equal(chosen.filter(w=>w.userId==='1').length,3);assert.match(chosen[0].reason,/風景/);assert.ok(chosen.some(w=>w.reason==='当前热门'));
});
test('adult recommendation flag requires authenticated account',async t=>{
  const r=new Recommendations({account:null},new TasteMemory(memoryFixture(t)));await assert.rejects(r.list({allowR18:true}),/登录/);
});
test('recommendation hydration preserves saved-state from artwork detail',async t=>{
  const m=new TasteMemory(memoryFixture(t));const client={account:{id:'7'},api:async(route)=>route==='discovery/artworks'?{thumbnails:{illust:[{id:'1',tags:['x'],bookmarkData:null}]}}:{id:route.split('/').pop(),tags:['x'],bookmarkData:{id:'saved'}},fetch:async()=>Response.json({contents:[{illust_id:'2',user_id:'u',title:'popular'}]})};
  const recommender=new Recommendations(client,m);const result=await recommender.list();assert.deepEqual(result.works.map(w=>w.id),['1']);
  m.seen.add('1');assert.equal((await recommender.list()).works.length,0);
});
test('recommendation enrichment keeps the ranking cover when the detail hides image URLs',async()=>{
  const {Recommendations,TasteMemory}=require('../src/recommend.cjs');const os=require('node:os'),path=require('node:path'),fs=require('node:fs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pl-'));const memory=new TasteMemory(path.join(dir,'t.json'));
  const client={account:null,api:async route=>({id:route.split('/').pop(),title:'t',urls:{small:null,regular:null},bookmarkData:null}),fetch:async()=>Response.json({contents:[{illust_id:'9',user_id:'u',title:'hot',url:'https://i.pximg.net/c/240x480/img-master/a.jpg'}]})};
  const result=await new Recommendations(client,memory).list({kind:'hot'});assert.equal(result.works[0].cover,'https://i.pximg.net/c/240x480/img-master/a.jpg');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('bookmark months come from Pixiv: the month filter is passed through and every work learns its month',async()=>{
  const months={'202609':['1','2','3'],'202608':['4','5']},calls=[];let saved;
  const client={account:{id:'7',premium:true},api:async(route,p)=>{calls.push({route,p});
    if(route.endsWith('/periods'))return [{period:'2026-09',count:3},{period:'2026-08',count:2},{period:'bad',count:1}];
    const ids=p.bm?months[p.bm]:['1','2','3','4','5'];
    return {total:ids.length,works:ids.slice(p.offset,p.offset+p.limit).map(id=>({id,title:'t',bookmarkData:{id:'b'+id}}))};}};
  const lib=new Library(client,{},()=>{},{saveMonths:v=>saved=JSON.parse(JSON.stringify(v))});
  assert.deepEqual(await lib.bookmarkPeriods({rest:'hide'}),[{period:'2026-09',count:3},{period:'2026-08',count:2}]);
  assert.equal(calls[0].p.rest,'hide');
  const filtered=await lib.bookmarks({bm:'2026-08'});
  assert.deepEqual(filtered.works.map(w=>[w.id,w.bookmarkMonth]),[['4','2026-08'],['5','2026-08']]);assert.equal(calls.at(-1).p.bm,'202608','sent like the website: no dash');
  assert.deepEqual(await lib.syncBookmarkMonths({}),{supported:true,periods:2,synced:2,known:5});
  assert.equal(saved.works['7:2'],'2026-09');assert.equal(saved.works['7:5'],'2026-08');
  const all=await lib.bookmarks({});assert.deepEqual(all.works.map(w=>w.bookmarkMonth),['2026-09','2026-09','2026-09','2026-08','2026-08']);
  const before=calls.length;assert.equal((await lib.syncBookmarkMonths({})).synced,0);assert.equal(calls.length-before,1,'unchanged months are not read again');
});
test('month sync stops safely when Pixiv ignores the month filter or offers no periods',async()=>{
  const lib=new Library({account:{id:'7',premium:true},api:async(route,p)=>route.endsWith('/periods')?[{period:'2026-09',count:3}]:{total:500,works:[{id:'1',title:'t'}]}});
  assert.equal((await lib.syncBookmarkMonths({})).supported,false);assert.deepEqual(lib.months.works,{});
  const none=new Library({account:{id:'7',premium:true},api:async()=>({})});
  assert.deepEqual(await none.syncBookmarkMonths({}),{supported:false,periods:0,synced:0,known:0});
  let asked=0;const basic=new Library({account:{id:'7',premium:false},api:async()=>{asked++;return {total:0,works:[]};}});
  assert.equal((await basic.syncBookmarkMonths({})).supported,false);assert.equal(asked,1,'without month data only the summary is requested');
});

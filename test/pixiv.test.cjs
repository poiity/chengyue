const test = require('node:test');
const assert = require('node:assert/strict');
const { PixivClient } = require('../src/pixiv.cjs');
function clientWith(handler) {
  const requests = [];
  const client = new PixivClient({ cookies: { async get() { return []; } }, async fetch(url, options) {
    requests.push({ url: new URL(url), options });
    return new Response(JSON.stringify({ error: false, body: handler(new URL(url)) }), { headers: { 'content-type': 'application/json' } });
  } });
  return { client, requests };
}
test('feed requires an account and preserves Pixiv pagination', async () => {
  const { client } = clientWith(() => ({ page: { isLastPage: false }, thumbnails: { illust: [{ id:'123',title:'新作',pageCount:2 }] } }));
  await assert.rejects(client.feed(), /请先登录/); client.account = { id:'1' };
  const result = await client.feed(2); assert.equal(result.works[0].id,'123'); assert.equal(result.page,2); assert.equal(result.hasMore,true);
});
test('premium search is gated and forwarded only for a premium account', async () => {
  const { client, requests } = clientWith(() => ({illustManga:{data:[{id:'1'}],total:100}}));
  await assert.rejects(client.search({query:'青色',order:'popular_d'}), /Premium/);
  client.account={id:'1',premium:true}; await client.search({query:'青色',order:'popular_d',page:2});
  assert.equal(requests[0].url.searchParams.get('order'),'popular_d');
  assert.equal(requests[0].url.searchParams.get('p'),'2'); assert.equal(requests[0].options.credentials,'include');
});
test('artist title search includes works outside the first page', async () => {
  const ids = Array.from({length:55},(_,i)=>String(100+i));
  const { client, requests } = clientWith(url => {
    if (url.pathname.endsWith('/profile/all')) return { illusts:Object.fromEntries(ids.map(id=>[id,null])),manga:{} };
    if (url.pathname.endsWith('/profile/illusts')) return { works:Object.fromEntries(url.searchParams.getAll('ids[]').map(id=>[id,{id,title:id==='100'?'older needle':'其他作品',userId:'7',userName:'画师'}])) };
    return {name:'画师'};
  });
  const first=await client.artist('7',1); assert.equal(first.works.length,48); assert.equal(first.works[0].id,'154'); assert.equal(first.hasMore,true);
  const found=await client.artist('7',1,'needle'); assert.equal(found.works.length,1); assert.equal(found.works[0].id,'100'); assert.equal(found.total,1);
  const before=requests.length; await client.artist('7',1,'needle'); assert.equal(requests.length,before);
});
test('HTML challenges and deleted artwork errors are actionable', async () => {
  const client = new PixivClient({fetch:async()=>new Response('<html>verify</html>')});
  await assert.rejects(client.api('illust/1'),/验证页面/);
  client.session.fetch=async()=>new Response('',{status:404}); await assert.rejects(client.api('illust/1'),/不存在/);
});
test('download rejects nonimage responses from image CDN', async () => {
  const client = new PixivClient({fetch:async()=>new Response('<html>verify</html>',{headers:{'content-type':'text/html'}})});
  await assert.rejects(client.fetch('https://i.pximg.net/1.png',{image:true}),/未返回图片/);
});

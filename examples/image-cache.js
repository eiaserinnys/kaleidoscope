// 이 파일을 image-cache JavaScript 자산 1판으로 등록한 뒤 예제를 올립니다.
(() => {
  const client = window.kaleidoscope;
  let surface = null, picture = null;
  const draw = () => {
    if (!surface || !picture) return;
    const context = surface.canvas.getContext('2d');
    context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    context.drawImage(picture, 0, 0, surface.canvas.width, surface.canvas.height);
  };
  const show = async (bytes, mime) => {
    picture = await createImageBitmap(new Blob([bytes], { type: mime }));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    client.publish({ status: `${bytes.byteLength} bytes · SHA-256 ${hash}` });
    draw();
  };
  client.surfaces.on('picture', value => { surface = value; if (surface) { surface.resize.addEventListener('resize', draw); draw(); } });
  client.handle('download', async () => {
    const { bytes, mime } = await client.http.read({ permission: 'image', path: '/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png', query: {} });
    await client.blobs.put({ key: 'cache/picture.png', bytes: bytes.slice(0) });
    await show(bytes, mime);
  });
  client.handle('restore', async () => {
    const file = await client.blobs.open({ key: 'cache/picture.png' });
    if (file) await show(await client.files.read(file.id), file.mime);
    else client.publish({ status: '보관된 그림 없음' });
  });
  client.handle('remove', async () => { await client.blobs.remove({ key: 'cache/picture.png' }); picture = null; client.publish({ status: '보관된 그림 없음' }); });
  const reportFile = async file => {
    const bytes = await client.files.read(file.id);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    client.publish({ status: `${bytes.byteLength} bytes · SHA-256 ${hash}` });
  };
  client.handle('upload', async ({ event }) => {
    const file = event.files?.[0];
    if (!file) return;
    await client.blobs.put({ key: 'cache/upload.bin', file_id: file.id });
    await reportFile(await client.blobs.open({ key: 'cache/upload.bin' }));
  });
  client.handle('restore_upload', async () => {
    const file = await client.blobs.open({ key: 'cache/upload.bin' });
    if (file) await reportFile(file);
    else client.publish({ status: '보관된 파일 없음' });
  });
})();

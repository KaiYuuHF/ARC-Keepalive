// 動画の再生中だけ、WebGPU でごく小さな計算を、前の計算が終わったらすぐ次を投げる形で続け、GPU を休ませない。
// Arc A580 が低フレームレート動画のデコード中にフレーム間でアイドルへ落ちると、
// 同じチップセット配下の USB オーディオ（AG03MK2）が途切れるため。
// 計算の間を 4ms 以上空けると効かなくなる（実測）ので、タイマーは挟まない。
// 画面には何も描かないので、Arc → RTX への画面転送（PCIe 3.0 x4 の帯域）を使わない。
(() => {
  const playing = new Set();
  let gpu = null;        // { device, pipeline, bindGroup }
  let gpuInit = null;    // 初期化中の Promise
  let running = false;
  let enabled = false;   // storage から読むまでは止めておく（ポップアップで切り替え）

  async function initGpu() {
    if (!navigator.gpu) throw new Error('WebGPU unavailable');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    const device = await adapter.requestDevice();
    const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE });
    const module = device.createShaderModule({ code: `
      @group(0) @binding(0) var<storage, read_write> d: array<f32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
        var x = d[id.x]; for (var i = 0u; i < 256u; i++) { x = x * 1.0001 + 0.5; } d[id.x] = x; }` });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
    // デバイスが失われたら作り直せるようにする
    device.lost.then(() => { gpu = null; gpuInit = null; });
    return { device, pipeline, bindGroup };
  }

  async function loop() {
    running = true;
    try {
      while (enabled && playing.size > 0) {
        if (!gpu) gpu = await (gpuInit ||= initGpu());
        const enc = gpu.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(gpu.pipeline);
        pass.setBindGroup(0, gpu.bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        gpu.device.queue.submit([enc.finish()]);
        await gpu.device.queue.onSubmittedWorkDone();
      }
    } catch (e) {
      console.warn('[arc-keepalive]', e);
      gpu = null; gpuInit = null;
    } finally {
      running = false;
    }
  }

  function update() {
    for (const v of playing) {
      if (v.paused || v.ended || !v.isConnected) playing.delete(v);
    }
    if (enabled && playing.size > 0 && !running) loop();
  }

  document.addEventListener('playing', e => {
    if (e.target instanceof HTMLVideoElement) { playing.add(e.target); update(); }
  }, true);
  for (const type of ['pause', 'ended', 'emptied']) {
    document.addEventListener(type, e => {
      if (e.target instanceof HTMLVideoElement) { playing.delete(e.target); update(); }
    }, true);
  }

  // 再生中の動画はオフの間も追跡しておき、オンに戻したらすぐ再開できるようにする
  chrome.storage.local.get({ enabled: true }, r => { enabled = r.enabled; update(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) { enabled = changes.enabled.newValue !== false; update(); }
  });
})();

async function initGPU(code, drawCount, bufferList) {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("need a browser that supports WebGPU");
    return;
  }

  // Get a WebGPU context from the canvas and configure it
  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("webgpu");
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: "premultiplied",
  });
  render({ device, context, presentationFormat, code, drawCount, bufferList });
}

function render({
  context,
  device,
  code,
  presentationFormat,
  drawCount = 3,
  bufferList,
}) {
  const pipeline = createPipeLine(device, code, presentationFormat, bufferList);
  const renderPassDescriptor = {
    label: "our basic canvas renderPass",
    colorAttachments: [
      {
        // view: <- to be filled out when we render
        clearValue: [0.3, 0.3, 0.3, 1],
        loadOp: "clear",
        storeOp: "store",
        view: context.getCurrentTexture().createView(),
      },
    ],
  };

  // make a command encoder to start encoding commands
  const encoder = device.createCommandEncoder({ label: "our encoder" });

  // make a render pass encoder to encode render specific commands
  const pass = encoder.beginRenderPass(renderPassDescriptor);
  const buffers = [];

  pass.setPipeline(pipeline);
  bufferList.forEach((bufferInfo) => {
    const { data, usage } = bufferInfo;
    const vertexBuffer = device.createBuffer({
      label: "Cell vertices",
      size: data.byteLength,
      usage,
    });
    buffers.push(vertexBuffer);
    pass.setVertexBuffer(0, vertexBuffer);
  });
  pass.draw(drawCount); // call our vertex shader 3 times.
  pass.end();

  const commandBuffer = encoder.finish();
  bufferList.forEach((info, index) => {
    device.queue.writeBuffer(buffers[index], /*bufferOffset=*/ 0, info.data);
  });
  device.queue.submit([commandBuffer]);
}

function createPipeLine(device, code, presentationFormat, bufferList) {
  const module = device.createShaderModule({
    label: "our hardcoded red triangle shaders",
    code,
  });
  let bufferLayouts = bufferList.map((buffer) => {
    return (
      buffer.layout || {
        arrayStride: 8,
        attributes: [
          {
            format: "float32x2",
            offset: 0,
            shaderLocation: 0,
          },
        ],
      }
    );
  });
  const pipeline = device.createRenderPipeline({
    label: "our hardcoded red triangle pipeline",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: bufferLayouts,
    },
    primitive: {
      topology: "triangle-list", //绘制三角形
    },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });
  return pipeline;
}

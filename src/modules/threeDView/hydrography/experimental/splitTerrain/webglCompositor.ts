// src/modules/threeDView/hydrography/experimental/splitTerrain/webglCompositor.ts
type GL = WebGL2RenderingContext;

function compile(gl: GL, type: number, src: string) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(info || "shader compile failed");
    }
    return sh;
}

function link(gl: GL, vs: WebGLShader, fs: WebGLShader) {
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error(info || "program link failed");
    }
    return p;
}

export function createWebglCompositor(outCanvas: HTMLCanvasElement) {
    const gl = outCanvas.getContext("webgl2", { premultipliedAlpha: false }) as GL | null;
    if (!gl) throw new Error("WebGL2 not available for split terrain compositor");

    const vs = compile(
        gl,
        gl.VERTEX_SHADER,
        `#version 300 es
    in vec2 aPos;
    out vec2 vUv;
    void main() {
      vUv = (aPos + 1.0) * 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`
    );

    const fs = compile(
        gl,
        gl.FRAGMENT_SHADER,
        `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uTop;
    uniform sampler2D uBottom;
    uniform sampler2D uMask;
    out vec4 outColor;
    void main() {
      vec4 topC = texture(uTop, vUv);
      vec4 botC = texture(uBottom, vUv);
      float m = texture(uMask, vUv).r; // white ocean = 1
      outColor = mix(topC, botC, m);
    }`
    );

    const prog = link(gl, vs, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
            -1, -1,
            +1, -1,
            -1, +1,
            -1, +1,
            +1, -1,
            +1, +1,
        ]),
        gl.STATIC_DRAW
    );

    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const texTop = gl.createTexture()!;
    const texBottom = gl.createTexture()!;
    const texMask = gl.createTexture()!;

    const setupTex = (t: WebGLTexture, unit: number, name: string) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const u = gl.getUniformLocation(prog, name);
        gl.useProgram(prog);
        gl.uniform1i(u, unit);
    };

    setupTex(texTop, 0, "uTop");
    setupTex(texBottom, 1, "uBottom");
    setupTex(texMask, 2, "uMask");

    const upload = (unit: number, tex: WebGLTexture, src: CanvasImageSource) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // If either Cesium canvas is “tainted” by cross-origin imagery without CORS,
        // texImage2D may throw a SecurityError. Caller catches and disables split mode.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    };

    const render = (top: HTMLCanvasElement, bottom: HTMLCanvasElement, mask: HTMLCanvasElement) => {
        const w = top.clientWidth | 0;
        const h = top.clientHeight | 0;
        if (outCanvas.width !== w) outCanvas.width = w;
        if (outCanvas.height !== h) outCanvas.height = h;

        gl.viewport(0, 0, outCanvas.width, outCanvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        upload(0, texTop, top);
        upload(1, texBottom, bottom);
        upload(2, texMask, mask);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const destroy = () => {
        gl.deleteTexture(texTop);
        gl.deleteTexture(texBottom);
        gl.deleteTexture(texMask);
        gl.deleteBuffer(vbo);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(prog);
    };

    return { render, destroy };
}

/**
 * 资产加载管线(设计文档 §10「资产管线」):
 * GLTFLoader + DRACOLoader + KTX2Loader 注册工厂。
 *
 * 重要:当前项目为零外部资产 —— 整座城市全部程序化生成(canvas 贴图 +
 * 代码几何),本模块只是给后续导入高精模型预留的管线,现阶段没有任何
 * 调用方真正 load 文件。decoder/transcoder 指向 node_modules 里 three
 * 自带的本地目录(经 Vite `?url` 资产引用,不引入任何外部二进制):
 *   node_modules/three/examples/jsm/libs/draco/gltf/  (draco_decoder.wasm 等)
 *   node_modules/three/examples/jsm/libs/basis/       (basis_transcoder.wasm 等)
 * 两个 loader 都是惰性加载:不遇到 draco 压缩网格 / ktx2 纹理不会请求任何文件。
 *
 * 已知取舍(注释即文档):生产 build 中 Vite 会给资产加内容哈希,
 * DRACOLoader/KTX2Loader 按固定文件名从目录取文件,届时若真要引入压缩资产,
 * 需在 vite.config 将 decoder 目录以原名拷入产物(assetFileNames/public),
 * 或接受本工厂的运行时降级:目录不可用时 console.info 并退回纯 GLTF
 * (未压缩 glb 始终可用)。
 */
import type { WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
// 经 Vite 解析出 three 本地 decoder/transcoder 的可服务 URL(确认真实存在的路径)
import dracoDecoderWasmUrl from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import basisTranscoderWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';

/** 城市资产加载器组合:gltf 永远可用;draco/ktx2 不可用时为 null(已降级)。 */
export interface CityAssetLoader {
  /** 主加载器,后续 load(url) 即可;draco/ktx2 已按需注册。 */
  gltf: GLTFLoader;
  /** Draco 网格解码器;null = 已降级为纯 GLTF。 */
  draco: DRACOLoader | null;
  /** KTX2/Basis 纹理转码器;null = 已降级(仅普通贴图)。 */
  ktx2: KTX2Loader | null;
  /** 释放 decoder worker 与 transcoder(切场景/卸载时调用)。 */
  dispose(): void;
}

/** 从单个文件 URL 推出其所在目录 URL(loader 需要以 / 结尾的目录)。 */
function dirOf(url: string): string | null {
  const cut = url.lastIndexOf('/');
  return cut >= 0 ? url.slice(0, cut + 1) : null;
}

/**
 * 创建并注册好 draco + ktx2 的 GLTF 加载管线。
 * renderer 用于 KTX2Loader.detectSupport(按 GPU 能力选转码目标格式)。
 * 任一 decoder 目录不可用时:console.info 说明并降级为纯 GLTF,不抛错。
 */
export function makeAssetLoader(renderer: WebGLRenderer): CityAssetLoader {
  const gltf = new GLTFLoader();
  let draco: DRACOLoader | null = null;
  let ktx2: KTX2Loader | null = null;

  const dracoDir = dirOf(dracoDecoderWasmUrl);
  if (dracoDir) {
    try {
      draco = new DRACOLoader();
      draco.setDecoderPath(dracoDir);
      gltf.setDRACOLoader(draco);
    } catch (err) {
      console.info('[city/loaders] Draco 解码器初始化失败,降级为纯 GLTF(不支持 draco 压缩网格):', err);
      draco = null;
    }
  } else {
    console.info('[city/loaders] 未找到本地 draco 解码目录,降级为纯 GLTF(不支持 draco 压缩网格)');
  }

  const basisDir = dirOf(basisTranscoderWasmUrl);
  if (basisDir) {
    try {
      ktx2 = new KTX2Loader();
      ktx2.setTranscoderPath(basisDir);
      ktx2.detectSupport(renderer);
      gltf.setKTX2Loader(ktx2);
    } catch (err) {
      console.info('[city/loaders] KTX2/Basis 转码器初始化失败,降级为普通贴图 GLTF:', err);
      ktx2 = null;
    }
  } else {
    console.info('[city/loaders] 未找到本地 basis 转码目录,降级为普通贴图 GLTF');
  }

  return {
    gltf,
    draco,
    ktx2,
    dispose() {
      draco?.dispose();
      ktx2?.dispose();
    },
  };
}

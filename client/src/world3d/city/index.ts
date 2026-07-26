/**
 * 「黄昏街区」城市渲染基建汇总出口(设计文档 §2/§5/§7/§10)。
 * 后续工单(街区布局/建筑/灯光/后期)一律从 './city' 引入,不直接触碰子模块路径。
 *
 * - palette:全局色板(ENV 环境组 / ACCENT 强调组)
 * - toon:夜景 4 阶 / 背景 2 阶 toon ramp 与统一材质工厂
 * - outline:反转外壳描边(按 view 距离收细)
 * - loaders:GLTF+DRACO+KTX2 资产管线(为后续导入预留,当前零外部资产)
 * - quality:画质档自动判定与 §10 预算常量表
 * - progressive:帧预算分帧构建队列(加载进度报告)
 */
export * from './palette';
export * from './toon';
export * from './outline';
export * from './loaders';
export * from './quality';
export * from './progressive';

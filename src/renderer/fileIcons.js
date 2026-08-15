/**
 * 文件类型图标映射（可配置）
 * 由 app.html 通过 <script> 在 app.js 之前加载，挂载到 window.NeutronFileIcons。
 * 从 app.js 抽离出的第一个纯数据/纯函数模块，验证「拆分布局」模式。
 */
(function () {
  'use strict';

  // 后缀 → 类型组（新增后缀只需在这里加一行）
  const FILE_ICON_EXT_TYPES = {
    // 可执行 / 安装程序
    exe: 'exe', msi: 'exe', bat: 'exe', cmd: 'exe',
    // 压缩包
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
    // 纯文本
    txt: 'text', log: 'text', md: 'text',
    // 办公文档
    doc: 'word', docx: 'word',
    xls: 'excel', xlsx: 'excel', csv: 'excel',
    ppt: 'ppt', pptx: 'ppt',
    pdf: 'pdf',
    // 图片
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bmp: 'image', webp: 'image', svg: 'image',
    // 音视频
    mp4: 'video', avi: 'video', mkv: 'video', mov: 'video', wmv: 'video',
    mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio',
    // 开发 / 代码
    py: 'code', js: 'code', html: 'code', css: 'code', java: 'code', json: 'code', xml: 'code',
    // 镜像安装包
    iso: 'disk', img: 'disk',
  };

  // 类型 → 线性 SVG 图标（stroke 用 currentColor，颜色由 CSS 主题控制）
  const FILE_ICON_SVGS = {
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    exe: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M12 15h5"/>',
    archive: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="10 2 10 6 14 6 14 10"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    text: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6"/><path d="M9 17h6"/>',
    word: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 12h6"/><path d="M9 15h6"/><path d="M9 18h3"/>',
    excel: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 12h2"/><path d="M13 12h2"/><path d="M9 15h2"/><path d="M13 15h2"/><path d="M9 18h2"/><path d="M13 18h2"/>',
    ppt: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 11v6"/><path d="M9 14h6"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 16c0-2 2-2 3-2s3 0 3 2-2 2-3 2-3 0-3-2z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8Z"/>',
    audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    code: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m10 9-3 3 3 3"/><path d="m14 9 3 3-3 3"/>',
    disk: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5"/><path d="M12 3v9"/>',
  };

  // 后缀 → 类型 → SVG
  function getFileIcon(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const type = FILE_ICON_EXT_TYPES[ext] || 'file';
    return { svg: FILE_ICON_SVGS[type] || FILE_ICON_SVGS.file, type };
  }

  window.NeutronFileIcons = { getFileIcon, FILE_ICON_EXT_TYPES, FILE_ICON_SVGS };
})();

#!/bin/sh
# 发布用素材：从 assets-src/web/ 的原件生成 src/assets/ 下的压缩版（构建时由 Vite 打进 dist/assets/，文件名带内容哈希）。
# 需要系统里已有 cwebp、ffmpeg（带 AudioToolbox 的 aac_at，macOS 自带）和 gzip。原件不改动，可随时重新生成。
#   贴图：颜色贴图转 WebP q82；法线贴图转 WebP q90（转了反而更大的，保留原 JPEG）；已是 WebP 的原样复制
#   模型：gzip 压缩为 .mshz（载入时用浏览器自带的 DecompressionStream 解开）
#   朗读：AAC（Apple 编码器，约 80 kbps 可变码率）装进 .m4a，moov 前置以便边下边播
set -e
cd "$(dirname "$0")/.."
SRC=assets-src/web
OUT=src/assets
mkdir -p "$OUT/tex" "$OUT/ref" "$OUT/audio"

size() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }

for f in "$SRC"/tex/*; do
  name=$(basename "$f"); stem=${name%.*}
  case "$name" in
    *.webp) cp "$f" "$OUT/tex/$name" ;;
    *)
      case "$stem" in *_nor_*) q=90 ;; *) q=82 ;; esac
      cwebp -quiet -q $q -m 6 -sharp_yuv "$f" -o "$OUT/tex/$stem.webp"
      if [ "$(size "$OUT/tex/$stem.webp")" -ge "$(size "$f")" ]; then rm "$OUT/tex/$stem.webp"; cp "$f" "$OUT/tex/$name"; fi
      ;;
  esac
done

for f in "$SRC"/ref/*.msh; do
  gzip -9 -n -c "$f" > "$OUT/ref/$(basename "$f" .msh).mshz"
done

for f in "$SRC"/audio/*.mp3; do
  ffmpeg -v error -y -i "$f" -map 0:a -c:a aac_at -aac_at_mode cvbr -b:a 96k -movflags +faststart "$OUT/audio/$(basename "$f" .mp3).m4a"
done

echo "原件 $(du -sh "$SRC" | cut -f1) → 发布用 $(du -sh "$OUT" | cut -f1)"
ls -l "$OUT"/tex "$OUT"/ref "$OUT"/audio | awk 'NF > 5 { printf "  %8d  %s\n", $5, $9 }'

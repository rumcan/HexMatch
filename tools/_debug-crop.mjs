import sharp from "sharp";
const [,, src, x, y, w, h, out] = process.argv;
await sharp(src, {limitInputPixels:false}).extract({left:+x, top:+y, width:+w, height:+h}).png().toFile(out);
console.log("wrote", out);

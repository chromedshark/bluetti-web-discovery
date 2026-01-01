import SparkMD5 from "spark-md5";

export function md5(data: Uint8Array): Uint8Array {
  const hashHex = SparkMD5.ArrayBuffer.hash(data as unknown as ArrayBuffer);
  return Uint8Array.fromHex(hashHex);
}

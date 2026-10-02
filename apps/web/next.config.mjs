/** @type {import("next").NextConfig} */
const nextConfig = {
  devIndicators: false,
  // แพ็กเกจของ workspace เป็น ESM ที่ build แล้ว และ db ใช้ Node API ให้ Node โหลดเองฝั่ง server แทนการ bundle
  serverExternalPackages: ['postgres', '@test-studio/db', '@test-studio/core'],
};
export default nextConfig;

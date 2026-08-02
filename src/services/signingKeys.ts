/**
 * 内容包签名的信任锚：公钥随应用一并分发（与 scripts/dev-signing-key.json
 * 中的开发 fixture 密钥对对应）。清单与签名都可被替换，但签名验证必须过
 * 这把内置公钥，因此替换清单无法让被篡改的内容通过校验。
 */
export const DEV_SIGNING_PUBLIC_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: '9zBCx8-3q1VFKZwnSZ5gpf0_8eiPpMrps5MQz4tg5oI',
  y: 'u0xHavcAj4P9cM-oTOmlWYctSJbNu5kvy1Hp0Jmpabw',
  ext: true
};

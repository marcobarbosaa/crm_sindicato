import Image from "next/image";
import styles from "./landing.module.css";

export function BrandSymbol({ size = 48 }: { size?: number }) {
  return <Image src="/branding/conecta-core-simbolo.svg" alt="" width={size} height={size} unoptimized />;
}

export function Brand() {
  return <span className={styles.brand}><BrandSymbol /><span>conecta<strong>core</strong></span></span>;
}

export function BrandGeometry() {
  return <div className={styles.geometry} aria-hidden="true"><div className={styles.orbit} /><div className={styles.orbitInner} /><div className={styles.symbolPlate}><BrandSymbol size={220} /></div><span className={styles.geometryPoint} /></div>;
}

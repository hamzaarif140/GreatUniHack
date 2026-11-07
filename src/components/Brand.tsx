import { APP_NAME } from "@/lib/brand";
import styles from "./Brand.module.css";

export function Brand() {
  return (
    <span className={styles.brand}>
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#0b57d0" />
        <circle cx="16" cy="16" r="5" fill="#fff" />
        <circle cx="16" cy="6.8" r="2.4" fill="#a8c7fa" />
        <circle cx="16" cy="25.2" r="2.4" fill="#a8c7fa" />
        <circle cx="6.8" cy="16" r="2.4" fill="#a8c7fa" />
        <circle cx="25.2" cy="16" r="2.4" fill="#a8c7fa" />
      </svg>
      {APP_NAME}
    </span>
  );
}

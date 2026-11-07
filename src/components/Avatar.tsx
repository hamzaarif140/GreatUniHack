import { initial } from "@/lib/identity";

interface AvatarProps {
  name: string;
  color: string;
  size?: number | string;
  className?: string;
}

export function Avatar({ name, color, size = 32, className }: AvatarProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        fontSize: typeof size === "number" ? size * 0.5 : `calc(${size} * 0.5)`,
        lineHeight: 1,
      }}
    >
      {initial(name)}
    </span>
  );
}

import React, { type ReactNode } from "react";
import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

// Smooth page transition wrapper
export function PageTransition({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Fade slide item for staggered lists
export function StaggerItem({
  children,
  index = 0,
  className = "",
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.3), ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Interactive card with smooth hover
export function MotionCard({
  children,
  className = "",
  onClick,
  style,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <motion.div
      whileHover={onClick ? { y: -3, transition: { duration: 0.18, ease: "easeOut" } } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      onClick={onClick}
      style={style}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Animated Stat Card
export function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  trend,
  color = "indigo",
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: LucideIcon;
  trend?: string;
  color?: "indigo" | "emerald" | "amber" | "rose" | "blue";
}) {
  const colorMap = {
    indigo: "from-indigo-500/10 to-purple-500/10 text-indigo-500 border-indigo-500/20",
    emerald: "from-emerald-500/10 to-teal-500/10 text-emerald-500 border-emerald-500/20",
    amber: "from-amber-500/10 to-orange-500/10 text-amber-500 border-amber-500/20",
    rose: "from-rose-500/10 to-pink-500/10 text-rose-500 border-rose-500/20",
    blue: "from-blue-500/10 to-cyan-500/10 text-blue-500 border-blue-500/20",
  };

  return (
    <div className="stat-card group">
      <div className="stat-card-top">
        <span className="stat-label">{label}</span>
        {Icon && (
          <div className={`stat-icon-wrap ${colorMap[color] || colorMap.indigo}`}>
            <Icon size={18} />
          </div>
        )}
      </div>
      <div className="stat-value-row">
        <b className="stat-value">{value}</b>
        {trend && <span className="stat-trend">{trend}</span>}
      </div>
      {sublabel && <small className="stat-sublabel">{sublabel}</small>}
    </div>
  );
}

// Circular Progress Ring
export function ProgressRing({
  percentage,
  size = 56,
  strokeWidth = 5,
  color = "#6366f1",
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-200 dark:text-slate-800"
          fill="transparent"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          strokeLinecap="round"
          fill="transparent"
        />
      </svg>
      <span className="absolute text-[11px] font-bold text-slate-700 dark:text-slate-200">
        {Math.round(percentage)}%
      </span>
    </div>
  );
}

// Modern Empty State
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="empty-state-modern"
    >
      <div className="empty-state-icon-glow">
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {actionLabel && onAction && (
        <button type="button" className="button button-primary empty-state-btn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </motion.div>
  );
}

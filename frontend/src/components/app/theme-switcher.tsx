"use client";

import { useTheme } from "@wrksz/themes/client";

export function ThemeSwitcher() {
	const { resolvedTheme, setTheme } = useTheme();

	if (!resolvedTheme) return null;

	const isDark = resolvedTheme === "dark";

	return (
		<button
			type="button"
			onClick={() => setTheme(isDark ? "light" : "dark")}
			aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
			className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
		>
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				className={`size-7 transition-transform duration-300 ${isDark ? "rotate-180" : "rotate-0"}`}
				aria-hidden="true"
			>
				<path
					d="M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12ZM5.7 12C5.7 15.48 8.52 18.3 12 18.3C15.48 18.3 18.3 15.48 18.3 12C18.3 8.52 15.48 5.7 12 5.7C8.52 5.7 5.7 8.52 5.7 12Z"
					fill={isDark ? "white" : "black"}
				/>
				<path
					d="M12 5C10.14 5 8.36 5.74 7.05 7.05C5.74 8.36 5 10.14 5 12C5 13.86 5.74 15.64 7.05 16.95C8.36 18.26 10.14 19 12 19L12 12V5Z"
					fill={isDark ? "white" : "black"}
				/>
			</svg>
		</button>
	);
}

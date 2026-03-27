"use client";

import Link from "next/link";

type HeaderSettingsButtonProps = {
  isActive: boolean;
};

export function HeaderSettingsButton({ isActive }: HeaderSettingsButtonProps) {
  return (
    <Link
      href="/settings"
      className={`site-nav__button header-settings__trigger ${isActive ? "is-active" : ""}`}
      aria-current={isActive ? "page" : undefined}
      aria-label="打开设置页面"
      title="设置"
    >
      <svg
        className="header-settings__icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.05-1.59a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.41.97a7.25 7.25 0 0 0-1.65-.95l-.36-2.56a.5.5 0 0 0-.5-.42h-4a.5.5 0 0 0-.5.42l-.36 2.56c-.59.24-1.15.56-1.65.95l-2.41-.97a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.05 1.59c-.04.31-.06.63-.06.94s.02.63.06.94l-2.05 1.59a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.41-.97c.5.39 1.06.71 1.65.95l.36 2.56a.5.5 0 0 0 .5.42h4a.5.5 0 0 0 .5-.42l.36-2.56c.59-.24 1.15-.56 1.65-.95l2.41.97a.5.5 0 0 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.05-1.59ZM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5Z"
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
        />
      </svg>
      <span className="sr-only">设置</span>
    </Link>
  );
}

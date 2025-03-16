"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";

type HeaderMenuLink = {
  label: string;
  href: string;
  icon?: React.ReactNode;
};

export const menuLinks: HeaderMenuLink[] = [
  {
    label: "Stealth Transfer",
    href: "/",
  },
  {
    label: "Register",
    href: "/register",
  }
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href, icon }) => {
        const isActive = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              passHref
              className={`${
                isActive 
                  ? "border-2 border-black dark:border-white pointer-events-none" 
                  : "text-gray-500 hover:bg-gray-500 hover:text-white dark:hover:text-white"
              } focus:!bg-transparent active:!text-neutral py-1.5 px-3 text-sm rounded gap-2 grid grid-flow-col font-mono transition-colors duration-200`}
            >
              {icon}
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </>
  );
};

/**
 * Site header
 */
export const Header = () => {
  return (
    <div className="sticky lg:static top-0 navbar dark:bg-black bg-white min-h-0 flex-shrink-0 justify-between z-20 border-b dark:border-zinc-800 border-gray-200 px-0 sm:px-2 transition-colors duration-200">
      <div className="navbar-start w-auto lg:w-1/2">
        <Link href="/" passHref className="flex items-center gap-2 ml-4 mr-6 shrink-0">
          <div className="flex flex-col">
            <span className="font-bold leading-tight font-mono">stealth.ereum</span>
            <span className="text-xs font-mono dark:text-gray-300 text-gray-700">Ethereum Privacy</span>
          </div>
        </Link>
        <ul className="flex flex-nowrap menu menu-horizontal px-1 gap-2">
          <HeaderMenuLinks />
        </ul>
      </div>
      <div className="navbar-end flex-grow mr-4">
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};

"use client";

import type { NextPage } from "next";
import { useAppContext } from "~~/contexts/AppContext";
import { StealthTransfer } from "~~/components/StealthTransfer";
import { Register } from "~~/components/Register";

const Home: NextPage = () => {
  const { activeView } = useAppContext();

  return (
    <div className="flex items-center justify-center flex-col flex-grow pt-10">
      <div className="px-5 text-center">
        {activeView === "stealth" ? <StealthTransfer /> : <Register />}
      </div>
    </div>
  );
};

export default Home;

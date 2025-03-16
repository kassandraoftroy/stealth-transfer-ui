"use client";

import type { NextPage } from "next";
import { StealthTransfer } from "~~/components/StealthTransfer";

const Home: NextPage = () => {
  return (
    <div className="flex items-center justify-center flex-col flex-grow pt-10">
      <div className="px-5 text-center">

        <StealthTransfer />
      </div>
    </div>
  );
};

export default Home;

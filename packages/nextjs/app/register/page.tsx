"use client";

import type { NextPage } from "next";
import { Register } from "~~/components/Register";

const RegisterPage: NextPage = () => {
  return (
    <div className="flex items-center justify-center flex-col flex-grow pt-10">
      <div className="px-5 text-center">
        <Register />
      </div>
    </div>
  );
};

export default RegisterPage;
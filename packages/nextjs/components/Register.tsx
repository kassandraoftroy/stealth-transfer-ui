"use client";

import { useState, useCallback } from "react";
import { Address, Chain, createPublicClient, http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { useAccount, useWriteContract } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import ERC6538Registry from "~~/contracts/ERC6538Registry.json";

// Constants
const REGISTRY_CONTRACT_ADDRESS = "0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538" as const;
const SCHEME_ID = 1n; // Using 1 as specified in the requirements
const DEFAULT_RPC_URL_SEPOLIA = "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_RPC_URL_MAINNET = "https://eth.llamarpc.com";

// Network prefixes
const NETWORK_PREFIXES = {
  eth: mainnet,
  sep: sepolia,
};

// Network RPC URLs
const NETWORK_RPC_URLS = {
  [mainnet.id]: process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || DEFAULT_RPC_URL_MAINNET,
  [sepolia.id]: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || DEFAULT_RPC_URL_SEPOLIA,
};

// Types
type NetworkPrefix = keyof typeof NETWORK_PREFIXES;

export const Register = () => {
  const { targetNetwork } = useTargetNetwork();
  const { address: connectedAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  
  // Stealth Meta Address input state
  const [stealthMetaAddressInput, setStealthMetaAddressInput] = useState<string>("");
  const [metaAddressError, setMetaAddressError] = useState<string | null>(null);
  
  // Transaction state
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState<boolean>(false);

  // Parse stealth meta address input
  const parseStealthMetaAddress = useCallback((input: string): { 
    networkPrefix: NetworkPrefix | null;
    metaAddress: string;
    isValid: boolean;
  } => {
    // Check if input matches the pattern: st:<prefix>:<hexdata>
    const match = input.match(/^st:(eth|sep):(.+)$/);
    
    if (!match) {
      return { 
        networkPrefix: null, 
        metaAddress: input,
        isValid: false
      };
    }
    
    const [, prefix, metaAddress] = match;
    const networkPrefix = prefix as NetworkPrefix;
    
    // Check if the meta address is a valid hex string and 66 bytes long (with 0x prefix would be 134 chars)
    let hexString = metaAddress;
    if (!hexString.startsWith("0x")) {
      hexString = "0x" + hexString;
    }
    
    const isValidHex = /^0x[0-9a-fA-F]+$/.test(hexString);
    const correctLength = hexString.length === 134; // 0x + 132 hex chars = 66 bytes

    return {
      networkPrefix,
      metaAddress: hexString,
      isValid: isValidHex && correctLength
    };
  }, []);

  const parsedMetaAddress = parseStealthMetaAddress(stealthMetaAddressInput);
  const isValidMetaAddressInput = parsedMetaAddress.isValid && parsedMetaAddress.networkPrefix !== null;
  
  // Get network chain from parsed input
  const getNetworkFromPrefix = useCallback((prefix: NetworkPrefix): Chain => {
    return NETWORK_PREFIXES[prefix];
  }, []);

  // Simplified function to get RPC URL for a network
  const getRpcUrl = useCallback((network: Chain): string => {
    // Get RPC URL from our predefined map, or use network's default as fallback
    return NETWORK_RPC_URLS[network.id as keyof typeof NETWORK_RPC_URLS] || network.rpcUrls.default.http[0];
  }, []);

  // Get current network to determine which registry to use
  const getNetworkChain = useCallback(() => {
    if (parsedMetaAddress.networkPrefix) {
      return getNetworkFromPrefix(parsedMetaAddress.networkPrefix);
    }
    return targetNetwork;
  }, [parsedMetaAddress.networkPrefix, getNetworkFromPrefix, targetNetwork]);
  
  // Check if connected wallet network matches the form's network
  const isCorrectNetwork = useCallback(() => {
    if (!isConnected || !connectedAddress) return false;
    
    const formNetwork = getNetworkChain();
    return formNetwork.id === targetNetwork.id;
  }, [isConnected, connectedAddress, getNetworkChain, targetNetwork]);

  // Handle registration
  const handleRegister = useCallback(async () => {
    if (!isConnected || !connectedAddress || !isValidMetaAddressInput) {
      return;
    }

    if (!isCorrectNetwork()) {
      setRegistrationError("Please switch your wallet to the correct network");
      return;
    }
    
    setIsRegistering(true);
    setRegistrationError(null);
    
    try {
      // Create a client for the current network
      const network = getNetworkChain();
      const client = createPublicClient({
        chain: network,
        transport: http(getRpcUrl(network)),
      });
      
      // Prepare the contract call
      const { request } = await client.simulateContract({
        address: REGISTRY_CONTRACT_ADDRESS as Address,
        abi: ERC6538Registry.abi,
        functionName: 'registerKeys',
        args: [SCHEME_ID, parsedMetaAddress.metaAddress],
        account: connectedAddress
      });

      const hash = await writeContractAsync(request);

      const receipt = await client.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        setIsRegistered(true);
      } else {
        console.error("Registration error: Transaction failed.");
        setRegistrationError(`Failed to register: Transaction failed.`);
      }
    } catch (error) {
      console.error("Registration error:", error);
      setRegistrationError(`Failed to register: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRegistering(false);
    }
  }, [
    isConnected, 
    connectedAddress, 
    isValidMetaAddressInput,
    isCorrectNetwork, 
    getNetworkChain, 
    getRpcUrl,
    writeContractAsync,
    parsedMetaAddress.metaAddress
  ]);

  // Handle restart after successful registration
  const handleRestart = useCallback(() => {
    setStealthMetaAddressInput("");
    setMetaAddressError(null);
    setIsRegistered(false);
    setRegistrationError(null);
  }, []);

  return (
    <div className="flex flex-col gap-4 py-8 px-4 sm:px-8 min-w-[32rem] max-w-xl mx-auto dark:bg-black bg-white dark:text-white text-black rounded-xl shadow-md dark:shadow-zinc-800 transition-colors duration-200">
      <h2 className="text-2xl font-bold text-center border-b dark:border-white border-black pb-4">Register Stealth Meta Address</h2>
      
      {/* Stealth Meta Address Input */}
      <div className="form-control w-full">
        <label className="label">
          <span className="label-text dark:text-gray-300 text-gray-700">Stealth Meta Address</span>
        </label>
        <div className="relative">
          <input
            type="text"
            placeholder="st:eth:0x... or st:sep:0x..."
            className={`input input-bordered w-full pr-10 font-mono 
              dark:bg-zinc-900 dark:border-white dark:text-white 
              bg-gray-100 border-gray-300 text-black
              transition-colors duration-200
              ${stealthMetaAddressInput && !isValidMetaAddressInput ? "!border-red-500" : ""}
            `}
            value={stealthMetaAddressInput}
            onChange={e => {
              setStealthMetaAddressInput(e.target.value);
              setMetaAddressError(null);
            }}
          />
          {stealthMetaAddressInput && isValidMetaAddressInput && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>
        
        {stealthMetaAddressInput && !isValidMetaAddressInput && (
          <label className="label">
            <span className="label-text-alt dark:text-red-400 text-red-600 font-mono text-xs">
              {!parsedMetaAddress.networkPrefix 
                ? "Format should be: st:eth:0x... or st:sep:0x..." 
                : "Stealth meta address must be exactly 66 bytes (132 hex characters)"}
            </span>
          </label>
        )}

        {/* Action Button */}
        {isValidMetaAddressInput && (
          <div className="mt-6">
            {!isConnected ? (
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button 
                    onClick={openConnectModal}
                    className="btn w-full dark:bg-white dark:text-black dark:hover:bg-gray-300 bg-black text-white hover:bg-gray-800 border-0 font-mono transition-colors duration-200"
                  >
                    Connect Wallet
                  </button>
                )}
              </ConnectButton.Custom>
            ) : (
              <div className="text-sm text-gray-500 mb-2">
                <span className="font-bold">{(connectedAddress && parsedMetaAddress) ? `${parsedMetaAddress.networkPrefix}:${connectedAddress.substring(0,6)}...${connectedAddress.substring(connectedAddress.length - 4)}` : ""}</span>
                {(connectedAddress && parsedMetaAddress) ? ` is registering it's stealth meta address as st:${parsedMetaAddress.networkPrefix}:${parsedMetaAddress.metaAddress.substring(0, 6)}...${parsedMetaAddress.metaAddress.substring(parsedMetaAddress.metaAddress.length - 4)}` : ""}
                <br></br><br></br>
                <button 
                  className={`btn w-full dark:bg-white dark:text-black dark:hover:bg-gray-300 bg-black text-white hover:bg-gray-800 border-0 font-mono transition-colors duration-200 ${isRegistering ? 'opacity-70' : ''}`}
                  disabled={!isCorrectNetwork() || isRegistering}
                  onClick={isRegistered ? handleRestart : handleRegister}
                >
                  {isRegistering ? "Registering..." :
                  !isCorrectNetwork() ? "Switch Network" : 
                  isRegistered ? "Register Another" : "Register"
                  }
                </button>
              </div>
            )}
            
            {registrationError && (
              <div className="mt-2">
                <span className="dark:text-red-400 text-red-600 text-xs font-mono">{registrationError}</span>
              </div>
            )}

            {isRegistered && !registrationError && (
              <div className="mt-2">
                <span className="dark:text-green-400 text-green-600 text-xs font-mono">Registration successful!</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Help Text */}
      <div className="mt-6 text-sm dark:text-gray-400 text-gray-600 border-t dark:border-zinc-800 border-gray-200 pt-4">
        <p className="mb-2">
          A stealth meta address is a cryptographic public key which enables you to receive funds onchain anonymously.
        </p>
        <p>
          It is recommended to connect and submit registration using the address attached to your primary ENS name (or the address most publicly known to correspond with your identity).
        </p>
      </div>
    </div>
  );
};
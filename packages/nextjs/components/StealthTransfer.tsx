"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { Address, Chain, createPublicClient, createWalletClient, http, isAddress, parseUnits } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { useAccount, useEnsAddress, useWriteContract } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { generateStealthAddress } from "@scopelift/stealth-address-sdk";
import ERC6538Registry from "~~/contracts/ERC6538Registry.json";

// Constants
const REGISTRY_CONTRACT_ADDRESS = "0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538" as const;
const SCHEME_ID = 1n; // Using 1 as specified in the requirements
const DEFAULT_RPC_URL_SEPOLIA = "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_RPC_URL_MAINNET = "https://eth.llamarpc.com";

// Stealthereum contract addresses
const STEALTHEREUM_ADDRESSES = {
  [mainnet.id]: "0x2f259C4ceB80E1383384BF7704F694Fb6f638dDC" as const,
  [sepolia.id]: "0x36d1fe257d1283aebBF7747e749B13258CC43c0b" as const,
};

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

// Common token lists by network
const COMMON_TOKENS = {
  [mainnet.id]: [
    { symbol: "ETH", name: "Ether", address: "NATIVE", decimals: 18, isERC721: false },
    { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, isERC721: false },
    { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, isERC721: false },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, isERC721: false },
    { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, isERC721: false },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, isERC721: false },
  ],
  [sepolia.id]: [
    { symbol: "ETH", name: "Ether", address: "NATIVE", decimals: 18, isERC721: false },
    { symbol: "USDC", name: "USD Coin (Test)", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6, isERC721: false },
    { symbol: "DAI", name: "Dai Stablecoin (Test)", address: "0x68194a729C2450ad26072b3D33ADaCbcef39D574", decimals: 18, isERC721: false },
  ],
};

// Types
type NetworkPrefix = keyof typeof NETWORK_PREFIXES;
type TokenInfo = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  isERC721?: boolean;
};

// Token interfaces for fetching token data
const ERC20_ABI = [
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    type: "function",
  }
] as const;

const ERC721_ABI = [
  {
    constant: true,
    inputs: [
      { name: "tokenId", type: "uint256" }
    ],
    name: "getApproved",
    outputs: [{ name: "operator", type: "address" }],
    type: "function"
  },
  {
    constant: false,
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "approve",
    outputs: [],
    type: "function",
  }
] as const;

const STEALTHEREUM_ABI = [
  {
    inputs: [
      {
        components: [
          { name: "schemeId", type: "uint256" },
          { name: "stealthAddress", type: "address" },
          { name: "ephemeralPubkey", type: "bytes" },
          { name: "viewTag", type: "uint8" },
          { name: "tokens", type: "address[]" },
          { name: "values", type: "uint256[]" },
          { name: "extraMetadata", type: "bytes" }
        ],
        internalType: "struct StealthTransfer",
        name: "transferData",
        type: "tuple"
      }
    ],
    name: "stealthTransfer",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const;

export const StealthTransfer = () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { targetNetwork } = useTargetNetwork();
  const { address: connectedAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  
  // ENS resolution for receiver address
  const [isResolvingEns, setIsResolvingEns] = useState<boolean>(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  
  // Receiver input state
  const [receiverInput, setReceiverInput] = useState<string>("");
  const [metaAddress, setMetaAddress] = useState<string | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState<boolean>(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  
  // Token selection state
  const [tokenInput, setTokenInput] = useState<string>("");
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState<boolean>(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [customTokenAddress, setCustomTokenAddress] = useState<string>("");
  const [showCustomTokenInput, setShowCustomTokenInput] = useState<boolean>(false);
  
  // Value/amount input state
  const [valueInput, setValueInput] = useState<string>("");
  const [valueError, setValueError] = useState<string | null>(null);
  const [processedValue, setProcessedValue] = useState<bigint | null>(null);
  
  // Transaction state
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState<boolean>(false);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isTransfered, setIsTransfered] = useState<boolean>(false);
  
  // Refs to track processing state
  const isProcessingMetaRef = useRef(false);
  const lastProcessedMetaInputRef = useRef("");
  const isProcessingTokenRef = useRef(false);
  const lastProcessedTokenInputRef = useRef("");
  
  // Ref to track if approval check is in progress
  const isCheckingApprovalRef = useRef(false);
  const approvalCheckCompletedRef = useRef(false);

  // Parse address input to extract network prefix and Ethereum address or ENS name
  const parseAddressInput = useCallback((input: string): { 
    networkPrefix: NetworkPrefix | null;
    address: string;
    isValid: boolean;
    isEns: boolean;
  } => {
    // Check if input matches the pattern: <prefix>:<address or ENS>
    const match = input.match(/^(eth|sep):(.*)$/);
    
    if (!match) {
      return { 
        networkPrefix: null, 
        address: input,
        isValid: false,
        isEns: false
      };
    }
    
    const [, prefix, address] = match;
    const address2 = address as string;
    const networkPrefix = prefix as NetworkPrefix;
    const isValidEthAddress = isAddress(address);
    const isEnsName = !isValidEthAddress && address2.includes('.eth') && address2.length > 5;
    
    return {
      networkPrefix,
      address,
      isValid: isValidEthAddress || isEnsName,
      isEns: isEnsName
    };
  }, []);

  // Parse the receiver input and token input
  const parsedReceiver = parseAddressInput(receiverInput);
  const parsedToken = parseAddressInput(tokenInput);
  
  // Set up the ENS resolver
  const { data: ensAddress, isLoading: isEnsLoading, error: ensError } = useEnsAddress({
    name: parsedReceiver.isEns ? parsedReceiver.address : undefined,
    chainId: parsedReceiver.networkPrefix === 'eth' ? mainnet.id : 
             parsedReceiver.networkPrefix === 'sep' ? sepolia.id : undefined,
    query: {
      enabled: parsedReceiver.isEns && parsedReceiver.networkPrefix !== null
    }
  });
  
  // Update the resolved address when the ENS resolution completes
  useEffect(() => {
    if (parsedReceiver.isEns) {
      setIsResolvingEns(isEnsLoading);
      if (ensAddress) {
        setResolvedAddress(ensAddress);
      } else if (ensError) {
        setResolvedAddress(null);
      }
    } else {
      setIsResolvingEns(false);
      setResolvedAddress(null);
    }
  }, [parsedReceiver.isEns, ensAddress, isEnsLoading, ensError]);
  
  const isValidReceiverInput = (parsedReceiver.isValid && parsedReceiver.networkPrefix !== null) && 
                              (!parsedReceiver.isEns || (parsedReceiver.isEns && ensAddress !== undefined));
  const isValidTokenInput = parsedToken.isValid && parsedToken.networkPrefix !== null;

  // Get network chain from parsed input
  const getNetworkFromPrefix = useCallback((prefix: NetworkPrefix) => {
    return NETWORK_PREFIXES[prefix];
  }, []);

  // Simplified function to get RPC URL for a network
  const getRpcUrl = useCallback((network: Chain): string => {
    // Get RPC URL from our predefined map, or use network's default as fallback
    return NETWORK_RPC_URLS[network.id as keyof typeof NETWORK_RPC_URLS] || network.rpcUrls.default.http[0];
  }, []);

  // Get available tokens for current network
  const getAvailableTokens = useCallback((networkPrefix: NetworkPrefix | null): TokenInfo[] => {
    if (!networkPrefix) return [];
    const network = getNetworkFromPrefix(networkPrefix);
    return COMMON_TOKENS[network.id as keyof typeof COMMON_TOKENS] || [];
  }, [getNetworkFromPrefix]);

  // Lookup stealth meta address
  const lookupMetaAddress = useCallback(async (input: string) => {
    const parsedResult = parseAddressInput(input);
    const isValid = parsedResult.isValid && parsedResult.networkPrefix !== null;
    
    // Don't proceed if:
    // 1. Input is not valid
    // 2. We're already processing a request
    // 3. We've already processed this exact input
    // 4. ENS is still resolving (if it's an ENS name)
    if (!isValid || 
        isProcessingMetaRef.current || 
        lastProcessedMetaInputRef.current === input ||
        (parsedResult.isEns && isResolvingEns)) {
      return;
    }
    
    try {
      // Set processing flag to prevent duplicate requests and clear previous results
      isProcessingMetaRef.current = true;
      
      // Clear previous results immediately to prevent UI flicker
      setMetaAddress(null); // Clear the meta address while loading
      setMetaError(null); // Clear any previous errors
      setIsLoadingMeta(true); // Show the loading state
      
      // Store this input as the last one processed
      lastProcessedMetaInputRef.current = input;

      // Get the network chain from the prefix
      const network = getNetworkFromPrefix(parsedResult.networkPrefix as NetworkPrefix);
      
      // Determine the address to use - either the direct address or resolved ENS address
      const addressToLookup = parsedResult.isEns ? resolvedAddress : parsedResult.address;
      
      // If we have an ENS name but couldn't resolve it, don't proceed
      if (parsedResult.isEns && !addressToLookup) {
        setMetaError("Could not resolve ENS name");
        setIsLoadingMeta(false);
        isProcessingMetaRef.current = false;
        return;
      }
      
      console.log("Looking up stealth meta address for:", addressToLookup);
      console.log("Network:", network.name);

      // Create a public client for the network specified in the input
      const publicClient = createPublicClient({
        chain: network,
        transport: http(getRpcUrl(network)),
      });

      // Use the public client to read from the contract
      const result = await publicClient.readContract({
        address: REGISTRY_CONTRACT_ADDRESS,
        abi: ERC6538Registry.abi,
        functionName: "stealthMetaAddressOf",
        args: [addressToLookup as Address, SCHEME_ID],
      });

      // Handle the response based on its type
      let hexString;
      if (result === null || result === undefined) {
        hexString = "0x"; // Empty result
      } else if (typeof result === "string") {
        // If already in hex format
        hexString = result.startsWith("0x") ? result : "0x" + result;
      } else if (result instanceof Uint8Array) {
        // Convert Uint8Array to hex
        hexString = "0x" + Buffer.from(result).toString("hex");
      } else if (Array.isArray(result)) {
        // Convert array to hex
        hexString = "0x" + Array.from(result, byte => byte.toString(16).padStart(2, "0")).join("");
      } else {
        // Fallback
        hexString = "0x" + result.toString();
      }

      console.log("Stealth meta address for", addressToLookup, ":", hexString);
      
      // Only update the meta address if we're still processing the same input
      // This prevents state updates for old queries
      if (lastProcessedMetaInputRef.current === input) {
        setMetaAddress(hexString);
      }
    } catch (e) {
      console.error("Error looking up stealth meta address:", e);
      
      // Only update error state if we're still processing the same input
      if (lastProcessedMetaInputRef.current === input) {
        setMetaError(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      // Only update loading state if we're still processing the same input
      if (lastProcessedMetaInputRef.current === input) {
        setIsLoadingMeta(false);
      }
      // Clear processing flag
      isProcessingMetaRef.current = false;
    }
  }, [parseAddressInput, getNetworkFromPrefix, getRpcUrl, isResolvingEns, resolvedAddress]);

  // Fetch token information
  const fetchTokenInfo = useCallback(async (input: string) => {
    const parsedResult = parseAddressInput(input);
    const isValid = parsedResult.isValid && parsedResult.networkPrefix !== null;
    
    // If "NATIVE" is selected for ETH
    if (input.toLowerCase() === "native" || input.toLowerCase() === "eth" || input.toLowerCase() === "ether") {
      if (parsedReceiver.networkPrefix) {
        const network = getNetworkFromPrefix(parsedReceiver.networkPrefix);
        const nativeToken = COMMON_TOKENS[network.id]?.find(t => t.address === "NATIVE");
        if (nativeToken) {
          setSelectedToken(nativeToken);
          setTokenInput("NATIVE");
          return;
        }
      }
    }
    
    // Don't proceed if:
    // 1. Input is not valid
    // 2. We're already processing a request
    // 3. We've already processed this exact input
    if (!isValid || isProcessingTokenRef.current || lastProcessedTokenInputRef.current === input) {
      return;
    }
    
    try {
      // Make sure the network prefixes match between receiver and token
      if (parsedReceiver.networkPrefix && parsedResult.networkPrefix !== parsedReceiver.networkPrefix) {
        setTokenError(`Network prefix mismatch. Please use ${parsedReceiver.networkPrefix}: for tokens`);
        return;
      }

      // Set processing flag to prevent duplicate requests
      isProcessingTokenRef.current = true;
      
      // Clear previous results immediately to prevent UI flicker
      setSelectedToken(null); // Clear the selected token while loading
      setTokenError(null); // Clear any previous errors
      setIsLoadingToken(true); // Show the loading state
      
      // Store this input as the last one processed
      lastProcessedTokenInputRef.current = input;
      // Store the raw token input (with network prefix)
      setTokenInput(input);

      // Get the network chain from the prefix
      const network = getNetworkFromPrefix(parsedResult.networkPrefix as NetworkPrefix);
      
      // Create a public client for the network specified in the input
      const publicClient = createPublicClient({
        chain: network,
        transport: http(getRpcUrl(network)),
      });

      // Get the actual token address without prefix
      const tokenAddress = parsedResult.address;

      // Try to fetch token information (catching errors for each call individually)
      let symbolResult = "-";
      let nameResult = "-";
      let decimalsResult: number | null = null;
      let isERC721 = false;
      let isValidToken = false;

      try {
        const symbol = await publicClient.readContract({
          address: tokenAddress as Address,
          abi: ERC20_ABI,
          functionName: "symbol",
        });
        symbolResult = typeof symbol === "string" ? symbol : "-";
        if (symbolResult !== "-") isValidToken = true;
      } catch (error) {
        console.log("Failed to fetch token symbol:", error);
      }

      try {
        const name = await publicClient.readContract({
          address: tokenAddress as Address,
          abi: ERC20_ABI,
          functionName: "name",
        });
        nameResult = typeof name === "string" ? name : "-";
        if (nameResult !== "-") isValidToken = true;
      } catch (error) {
        console.log("Failed to fetch token name:", error);
      }

      try {
        const decimals = await publicClient.readContract({
          address: tokenAddress as Address,
          abi: ERC20_ABI,
          functionName: "decimals",
        });
        decimalsResult = Number(decimals);
        if (decimalsResult !== null) isValidToken = true;
      } catch (error) {
        console.log("Failed to fetch token decimals:", error);
        isERC721 = true;
      }

      // If all fields failed to load, it's likely not a valid token
      if (!isValidToken) {
        // Only update error state if we're still processing the same input
        if (lastProcessedTokenInputRef.current === input) {
          setTokenError("Address does not appear to be a valid token contract");
          setIsLoadingToken(false);
        }
        isProcessingTokenRef.current = false;
        return;
      }
      
      const tokenInfo: TokenInfo = {
        symbol: symbolResult,
        name: nameResult,
        address: tokenAddress,
        decimals: decimalsResult !== null ? decimalsResult : 0, // Use 0 for NFTs
        isERC721: isERC721,
      };

      console.log("Token info fetched:", tokenInfo);
      
      // Only update state if we're still processing the same input
      if (lastProcessedTokenInputRef.current === input) {
        setSelectedToken(tokenInfo);
      }
    } catch (e) {
      console.error("Error fetching token info:", e);
      
      // Only update error state if we're still processing the same input
      if (lastProcessedTokenInputRef.current === input) {
        setTokenError(`Error fetching token data: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      // Only update loading state if we're still processing the same input
      if (lastProcessedTokenInputRef.current === input) {
        setIsLoadingToken(false);
      }
      // Clear processing flag
      isProcessingTokenRef.current = false;
    }
  }, [parseAddressInput, parsedReceiver.networkPrefix, getNetworkFromPrefix, getRpcUrl]);

  // Effect to trigger meta address lookup when receiver input changes or ENS resolves
  useEffect(() => {
    // For tracking the current debounce timer
    let debounceTimeout: NodeJS.Timeout | undefined;
    
    // Function to clear state when input is empty or invalid
    const clearMetaState = () => {
      setIsLoadingMeta(false);
      setMetaAddress(null);
      setMetaError(null);
      lastProcessedMetaInputRef.current = ""; // Reset last processed input
      
      // Reset token-related state as well
      setSelectedToken(null);
      setTokenInput("");
      setShowCustomTokenInput(false);
      setValueInput("");
      setProcessedValue(null);
    };
    
    // Skip empty inputs
    if (!receiverInput || receiverInput.trim() === '') {
      clearMetaState();
      return;
    }
    
    // Parse input first to check if it's valid
    const parsed = parseAddressInput(receiverInput);
    const isValid = parsed.isValid && parsed.networkPrefix !== null;
    
    // If the input is invalid, clear the meta state
    if (!isValid) {
      clearMetaState();
      return;
    }
    
    // If the input is changing, immediately set loading state for better UX
    if (lastProcessedMetaInputRef.current !== receiverInput && !isLoadingMeta) {
      setIsLoadingMeta(true);
    }
    
    // If it's an ENS name, wait for resolution before looking up meta address
    if (parsed.isEns) {
      // If we're still resolving the ENS name, don't proceed with meta lookup
      if (isResolvingEns) {
        return;
      }
      
      // If ENS resolution completed and we have an address
      if (resolvedAddress) {
        // Cancel any existing timer and set a new one
        clearTimeout(debounceTimeout);
        
        // If we haven't processed this input yet or the ENS just resolved
        if (!isProcessingMetaRef.current && lastProcessedMetaInputRef.current !== receiverInput) {
          debounceTimeout = setTimeout(() => {
            lookupMetaAddress(receiverInput);
          }, 500);
        }
      } else {
        // If ENS resolution failed, clear the meta state
        clearMetaState();
      }
      
      return () => clearTimeout(debounceTimeout);
    }
    
    // For regular addresses, proceed with meta lookup
    if (isValid && !isProcessingMetaRef.current && lastProcessedMetaInputRef.current !== receiverInput) {
      // Cancel any existing timer and set a new one
      clearTimeout(debounceTimeout);
      
      debounceTimeout = setTimeout(() => {
        lookupMetaAddress(receiverInput);
      }, 500);
      
      return () => clearTimeout(debounceTimeout);
    }
    
    // Cleanup function
    return () => {
      clearTimeout(debounceTimeout);
    };
  }, [receiverInput, lookupMetaAddress, parseAddressInput, isResolvingEns, resolvedAddress]);

  // Effect to trigger token info fetch when token input changes
  useEffect(() => {
    // Skip if we're showing the dropdown and not using custom input
    if (!showCustomTokenInput) return;
    
    // Skip empty inputs
    if (customTokenAddress.trim() === '') {
      setIsLoadingToken(false);
      lastProcessedTokenInputRef.current = ""; // Reset last processed input
      return;
    }
    
    // Make sure we have a valid receiver first
    if (!parsedReceiver.networkPrefix) return;
    
    // Check if the token input already has a network prefix
    const tokenHasPrefix = customTokenAddress.match(/^(eth|sep):/);
    let fullTokenInput;
    
    if (tokenHasPrefix) {
      // If it has a prefix, use it as is
      fullTokenInput = customTokenAddress;
      
      // Parse to check if networks match
      const parsed = parseAddressInput(fullTokenInput);
      if (parsed.networkPrefix !== parsedReceiver.networkPrefix) {
        setTokenError(`Network prefix mismatch. Please use ${parsedReceiver.networkPrefix}: for tokens`);
        return;
      }
    } else {
      // If no prefix, add the receiver's network prefix
      fullTokenInput = `${parsedReceiver.networkPrefix}:${customTokenAddress}`;
    }
    
    // Parse input to check if it's valid
    const parsed = parseAddressInput(fullTokenInput);
    const isValid = parsed.isValid && parsed.networkPrefix !== null;
    
    // Only proceed with valid inputs that we haven't processed yet
    if (isValid && !isProcessingTokenRef.current && lastProcessedTokenInputRef.current !== fullTokenInput) {
      // Use a shorter debounce since we're being more careful about redundant requests
      const debounceTimeout = setTimeout(() => {
        fetchTokenInfo(fullTokenInput);
      }, 300);
      
      return () => clearTimeout(debounceTimeout);
    }
  }, [customTokenAddress, showCustomTokenInput, parsedReceiver.networkPrefix, fetchTokenInfo, parseAddressInput]);
  

  // Status indicator for receiver input
  const ReceiverStatusIndicator = useCallback(() => {
    // Don't show indicator for invalid or empty input
    if (!receiverInput || receiverInput.trim() === "") {
      return null;
    }
    
    const parsed = parseAddressInput(receiverInput);
    
    // Show loading spinner during any async operation - ENS resolving or meta lookup
    if ((parsed.isEns && isResolvingEns) || isLoadingMeta) {
      return <span className="loading loading-spinner loading-xs text-primary"></span>;
    }
    
    // Show error if ENS name couldn't be resolved
    if (parsed.isEns && !isResolvingEns && !resolvedAddress && parsed.networkPrefix) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    }
    
    // For valid inputs that aren't loading, proceed with status indicators
    if (!isValidReceiverInput) {
      return null;
    }
    
    // Error indicator - only show when not loading and there's an error or no meta address
    if (metaError || (!metaAddress && !isLoadingMeta) || metaAddress === "0x") {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    }
    
    // Success indicator - only show when we have a valid meta address
    if (metaAddress && metaAddress !== "0x") {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    
    return null;
  }, [receiverInput, isValidReceiverInput, isLoadingMeta, metaError, metaAddress, isResolvingEns, resolvedAddress, parseAddressInput]);

  // Status indicator for token input
  const TokenStatusIndicator = useCallback(() => {
    if (!showCustomTokenInput) return null;
    
    // Don't show indicator for invalid or empty input
    if (!customTokenAddress || customTokenAddress.trim() === "") {
      return null;
    }
    
    // Always show loading spinner during token info lookup
    if (isLoadingToken) {
      return <span className="loading loading-spinner loading-xs text-primary"></span>;
    }
    
    // Only show error when not loading and there's an error
    if (tokenError && !isLoadingToken) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    }
    
    // Only show success when we have valid token info
    if (selectedToken && !isLoadingToken) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    
    return null;
  }, [showCustomTokenInput, customTokenAddress, isLoadingToken, tokenError, selectedToken]);

  // Create a ref to the dropdown element so we can close it
  const tokenDropdownRef = useRef<HTMLUListElement>(null);
  
  // Handle token selection from dropdown
  const handleTokenSelect = useCallback((token: TokenInfo) => {
    // Update token selection state
    setSelectedToken(token);
    
    // Store the token input with network prefix (or NATIVE for ETH)
    if (token.address === "NATIVE") {
      setTokenInput("NATIVE");
    } else if (parsedReceiver.networkPrefix) {
      setTokenInput(`${parsedReceiver.networkPrefix}:${token.address}`);
    }
    
    // Reset all input fields when token changes
    setValueInput("");
    setProcessedValue(null);
    setValueError(null);
    setShowCustomTokenInput(false);
    setCustomTokenAddress("");
    
    // Programmatically close the dropdown by removing focus from the dropdown menu
    // This is how we handle closing the dropdown in DaisyUI
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    // For extra measure, we can also try to remove focus from the dropdown element directly
    if (tokenDropdownRef.current) {
      tokenDropdownRef.current.blur();
    }
  }, [parsedReceiver.networkPrefix]);
  
  // Process and validate the value input
  const processValueInput = useCallback((input: string) => {
    if (!selectedToken) return;
    
    // Clear previous errors
    setValueError(null);
    
    // Empty input
    if (!input || input.trim() === "") {
      setProcessedValue(null);
      return;
    }
    
    // Only allow numbers and decimal points
    if (!/^[0-9.]+$/.test(input)) {
      setValueError("Only numbers and decimal points allowed");
      setProcessedValue(null);
      return;
    }
    
    try {
      if (selectedToken.isERC721) {
        // For NFTs, the input is a tokenId which should be an integer
        if (input.includes('.')) {
          setValueError("Token ID must be an integer");
          setProcessedValue(null);
          return;
        }
        
        // Convert to BigInt directly
        setProcessedValue(BigInt(input));
      } else {
        // For ERC20 tokens, apply decimals
        // First check if the input has too many decimal places
        const parts = input.split('.');
        if (parts.length > 1 && parts[1].length > selectedToken.decimals) {
          setValueError(`Maximum ${selectedToken.decimals} decimal places allowed`);
          setProcessedValue(null);
          return;
        }
        
        // Parse as fixed point and apply decimals
        try {
          const value = parseUnits(input, selectedToken.decimals);
          setProcessedValue(value);
        } catch (error) {
          console.error("Error parsing value:", error);
          setValueError("Invalid number format");
          setProcessedValue(null);
        }
      }
    } catch (error) {
      console.error("Error processing value:", error);
      setValueError("Invalid input");
      setProcessedValue(null);
    }
  }, [selectedToken]);
  
  // Effect to process value input when it changes
  useEffect(() => {
    if (!selectedToken) return;
    
    // Debounce the processing to avoid excessive calculations while typing
    const debounceTimeout = setTimeout(() => {
      processValueInput(valueInput);
    }, 300);
    
    return () => clearTimeout(debounceTimeout);
  }, [valueInput, selectedToken, processValueInput]);
  
  // Get current network to determine stealthereum address
  const getNetworkChain = useCallback(() => {
    if (parsedReceiver.networkPrefix) {
      return getNetworkFromPrefix(parsedReceiver.networkPrefix);
    }
    return targetNetwork;
  }, [parsedReceiver.networkPrefix, getNetworkFromPrefix, targetNetwork]);

  // Check if connected wallet network matches the form's network
  const isCorrectNetwork = useCallback(() => {
    if (!isConnected || !connectedAddress) return false;
    
    const formNetwork = getNetworkChain();
    return formNetwork.id === targetNetwork.id;
  }, [isConnected, connectedAddress, getNetworkChain, targetNetwork]);

  // Get stealth contract address based on current network
  const getStealthContractAddress = useCallback(() => {
    const network = getNetworkChain();
    return STEALTHEREUM_ADDRESSES[network.id as keyof typeof STEALTHEREUM_ADDRESSES] || STEALTHEREUM_ADDRESSES[mainnet.id];
  }, [getNetworkChain]);

  // Check if the token is approved for the stealthereum contract
  const checkApprovalStatus = useCallback(async () => {
    // This function is called only when we've already verified these conditions
    if (!isConnected || !connectedAddress || !selectedToken || !processedValue || !isCorrectNetwork()) {
      return;
    }
    
    // We're already in a context where isCheckingApprovalRef.current is true
    
    try {
      // Clear any previous errors
      setApprovalError(null);
      
      const stealthereumAddress = getStealthContractAddress();
      const network = getNetworkChain();
      
      const publicClient = createPublicClient({
        chain: network,
        transport: http(getRpcUrl(network))
      });
      
      console.log(`Checking approval for ${selectedToken.symbol} amount: ${processedValue.toString()}`);
      
      if (selectedToken.isERC721) {
        // For ERC721 tokens, check specific token approval
        try {
          const approvedAddress = await publicClient.readContract({
            address: selectedToken.address as Address,
            abi: ERC721_ABI,
            functionName: 'getApproved',
            args: [processedValue] // tokenId
          });
          
          const isApprovedForToken = approvedAddress === stealthereumAddress;
          console.log(`NFT approval status:`, isApprovedForToken);
          setIsApproved(isApprovedForToken);
        } catch (error) {
          console.error("Error checking ERC721 approval:", error);
          setApprovalError(`Error checking NFT approval: ${error instanceof Error ? error.message : String(error)}`);
          setIsApproved(false);
        }
      } else {
        // For ERC20 tokens, check allowance
        try {
          const allowance = await publicClient.readContract({
            address: selectedToken.address as Address,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [connectedAddress as Address, stealthereumAddress as Address]
          });
          
          // Check if allowance is at least as large as the amount we want to transfer
          const hasEnoughAllowance = BigInt(allowance as string | number) >= processedValue;
          console.log(`Token allowance: ${allowance} vs needed: ${processedValue}`);
          console.log(`Approved: ${hasEnoughAllowance}`);
          setIsApproved(hasEnoughAllowance);
        } catch (error) {
          console.error("Error checking ERC20 allowance:", error);
          setApprovalError(`Error checking token allowance: ${error instanceof Error ? error.message : String(error)}`);
          setIsApproved(false);
        }
      }
    } catch (error) {
      console.error("Error in approval status check:", error);
      setApprovalError(`Error checking approval status: ${error instanceof Error ? error.message : String(error)}`);
      setIsApproved(false);
    } finally {
      // The calling function handles setting the flags
    }
  }, [
    isConnected, 
    connectedAddress, 
    selectedToken, 
    processedValue, 
    isCorrectNetwork, 
    getStealthContractAddress, 
    getNetworkChain,
    getRpcUrl
  ]);

  // Reset approval state when receiver or token changes
  useEffect(() => {
    // When receiver or token changes, we need to reset approval state
    setIsApproved(false);
    approvalCheckCompletedRef.current = false;
    isCheckingApprovalRef.current = false;
    // Also reset the last checked amount to force a new check
    lastCheckedAmountRef.current = "0";
  }, [receiverInput, selectedToken]);
  
  // Track the last checked amount to ensure we re-check when it changes
  const lastCheckedAmountRef = useRef<string>("0");
  
  // Effect to check approval status WHEN the processed amount value changes
  useEffect(() => {
    // Only run the check when we have a valid processed value
    if (!processedValue || !isConnected || !connectedAddress || !selectedToken || !isCorrectNetwork()) {
      return;
    }
    
    // Convert to string for stable comparison
    const currentAmount = processedValue.toString();
    
    // Fast path for native tokens (no approval needed)
    if (selectedToken.address === "NATIVE") {
      setIsApproved(true);
      approvalCheckCompletedRef.current = true;
      isCheckingApprovalRef.current = false;
      // Update the last checked amount
      lastCheckedAmountRef.current = currentAmount;
      return;
    }

    // Skip if the exact same amount was already checked
    // This is important! Without this, we could end up in an infinite loop
    // because setting isApproved can trigger a re-render
    if (lastCheckedAmountRef.current === currentAmount) {
      console.log("Skipping duplicate check for same amount:", currentAmount);
      return;
    }
    
    // Don't run a new check if one is already in progress for different amount
    if (isCheckingApprovalRef.current) {
      return;
    }
    
    // Start the approval check for the new amount
    const runApprovalCheck = async () => {
      console.log("Running approval check for amount:", currentAmount, 
                  "previous checked amount was:", lastCheckedAmountRef.current);
      
      // Reset the flags and state to show we're checking
      isCheckingApprovalRef.current = true;
      approvalCheckCompletedRef.current = false;
      setIsApproved(false); // Reset approval state for now
      
      try {
        // Update the last checked amount BEFORE checking
        // This prevents re-runs if there are state updates
        lastCheckedAmountRef.current = currentAmount;
        
        // Run the actual status check
        await checkApprovalStatus();
      } catch (error) {
        console.error("Error in approval check:", error);
      } finally {
        // Mark the check as completed even if there was an error
        approvalCheckCompletedRef.current = true;
        // Clear the checking flag
        isCheckingApprovalRef.current = false;
      }
    };
    
    // Run the check immediately (we've already handled debouncing in the processValue effect)
    runApprovalCheck();
    
    // Cleanup function
    return () => {
      // If the component unmounts during a check, we should reset flags
      // This is rare but possible
    };
  }, [processedValue, isConnected, connectedAddress, selectedToken, isCorrectNetwork, checkApprovalStatus]);

  // Handle custom token option
  const handleCustomTokenOption = useCallback(() => {
    setSelectedToken(null);
    setShowCustomTokenInput(true);
    setCustomTokenAddress("");
    
    // Close the dropdown
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    if (tokenDropdownRef.current) {
      tokenDropdownRef.current.blur();
    }
  }, []);
  
  const handleTransfer = useCallback(async () => {
    if (!isConnected || !connectedAddress || !selectedToken || !processedValue || !metaAddress) {
      return;
    }

    if (!isCorrectNetwork()) {
      setTransferError("Please switch your wallet to the correct network");
      return;
    }
    
    setIsTransferring(true);
    setTransferError(null);
    try {
      //Create a client for the current network
      const network = getNetworkChain();
      const client = createPublicClient({
        chain: network,
        transport: http(getRpcUrl(network)),
      });
      const stealthereumAddress = getStealthContractAddress();

      const result = generateStealthAddress({stealthMetaAddressURI: metaAddress});
      const viewTag = parseInt(result.viewTag.replace('0x', ''), 16);
      
      // Prepare the contract params with BigInt values correctly serialized
      const tokenAddress = selectedToken.address === "NATIVE" ? 
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address : 
        selectedToken.address as Address;
        
      // Send the transaction using the wallet client
      const { request } = await client.simulateContract({
        address: stealthereumAddress as Address,
        abi: STEALTHEREUM_ABI,
        functionName: 'stealthTransfer',
        args: [{
          schemeId: 1n,
          stealthAddress: result.stealthAddress,
          ephemeralPubkey: result.ephemeralPublicKey,
          viewTag: viewTag,
          tokens: selectedToken.address === "NATIVE" ? [] : [tokenAddress as Address],
          values: selectedToken.address === "NATIVE" ? [] : [processedValue],
          extraMetadata: "",
        }],
        account: connectedAddress,
        value: selectedToken.address !== "NATIVE" ? 0n : processedValue
      });

      const hash = await writeContractAsync(request);

      // Wait for transaction confirmation
      const receipt = await client.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        setIsTransfered(true);
      } else {
        console.error("Transfer error: Transaction failed.");
        setTransferError(`Failed to transfer: Transaction failed.`);
      }
    } catch (error) {
      console.error("Transfer error:", error);
      setTransferError(`Failed to transfer: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsTransferring(false);
    }
    
  }, [
    isConnected, 
    connectedAddress, 
    selectedToken, 
    processedValue, 
    isCorrectNetwork, 
    getStealthContractAddress, 
    getNetworkChain, 
    getRpcUrl,
    metaAddress,
    writeContractAsync
  ]);
  
  // Handle approval transaction
  const handleApprove = useCallback(async () => {
    if (!isConnected || !connectedAddress || !selectedToken || !processedValue) {
      return;
    }
    
    if (!isCorrectNetwork()) {
      setApprovalError("Please switch your wallet to the correct network");
      return;
    }
    
    setIsApproving(true);
    setApprovalError(null);
    
    try {
      // Reset approval check flags - we're now in approval mode, not checking mode
      isCheckingApprovalRef.current = false;
      approvalCheckCompletedRef.current = true; // Mark as completed since we're now approving
      
      const stealthereumAddress = getStealthContractAddress();
      
      if (selectedToken.address === "NATIVE") {
        // For native token, no approval is needed
        setIsApproved(true);
        approvalCheckCompletedRef.current = true;
        lastCheckedAmountRef.current = processedValue ? processedValue.toString() : "0";
        return;
      }
      
      // Create a client for the current network
      const network = getNetworkChain();
      const publicClient = createPublicClient({
        chain: network,
        transport: http(getRpcUrl(network))
      });

      if (selectedToken.isERC721) {
        console.log(`Approving ${processedValue.toString()} tokens for ${stealthereumAddress}`);
        const { request } = await publicClient.simulateContract({
          address: selectedToken.address as Address,
          abi: ERC721_ABI,
          functionName: 'approve',
          args: [stealthereumAddress as Address, processedValue],
          account: connectedAddress as Address,
        });
        
        const hash = await writeContractAsync(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
        if (receipt.status === "success") {
          setIsApproved(true);
          approvalCheckCompletedRef.current = true;
          lastCheckedAmountRef.current = processedValue.toString();
        } else {
          console.error("Token Approval error: Transaction failed.");
          setApprovalError(`Failed to approve token: Transaction failed.`);
        }
      } else  {
        console.log(`Approving ${processedValue.toString()} tokens for ${stealthereumAddress}`);
        const { request } = await publicClient.simulateContract({
          address: selectedToken.address as Address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [stealthereumAddress as Address, processedValue],
          account: connectedAddress as Address,
        });

        const hash = await writeContractAsync(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
        if (receipt.status === "success") {
          setIsApproved(true);
          approvalCheckCompletedRef.current = true;
          lastCheckedAmountRef.current = processedValue.toString();
        } else {
          console.error("Token Approval error: Transaction failed.");
          setApprovalError(`Failed to approve token: Transaction failed.`);
        }
      }
    } catch (error) {
      console.error("Approval error:", error);
      setApprovalError(`Failed to approve: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsApproving(false);
    }
  }, [
    isConnected, 
    connectedAddress, 
    selectedToken, 
    processedValue, 
    isCorrectNetwork, 
    getStealthContractAddress, 
    getNetworkChain, 
    getRpcUrl,
    writeContractAsync
  ]);

  const handleRestart = useCallback(() => {
    // Reset transaction and approval states
    setIsTransfered(false);
    setIsApproved(false);
    setIsApproving(false);
    setIsTransferring(false);
    setTransferError(null);
    setApprovalError(null);
    
    // Reset all input state variables to initial values
    setReceiverInput("");
    setMetaAddress(null);
    setIsLoadingMeta(false);
    setMetaError(null);
    
    setTokenInput("");
    setSelectedToken(null);
    setIsLoadingToken(false);
    setTokenError(null);
    setCustomTokenAddress("");
    setShowCustomTokenInput(false);
    
    setValueInput("");
    setValueError(null);
    setProcessedValue(null);
    
    setIsResolvingEns(false);
    setResolvedAddress(null);
    
    // Reset refs
    isProcessingMetaRef.current = false;
    lastProcessedMetaInputRef.current = "";
    isProcessingTokenRef.current = false;
    lastProcessedTokenInputRef.current = "";
    isCheckingApprovalRef.current = false;
    approvalCheckCompletedRef.current = false;
    lastCheckedAmountRef.current = "0"; // Reset the last checked amount
  }, []);
  
  // Get available tokens based on receiver's network
  const availableTokens = getAvailableTokens(parsedReceiver.networkPrefix);

  return (
    <div className="flex flex-col gap-4 py-8 px-4 sm:px-8 min-w-[32rem] max-w-xl mx-auto dark:bg-black bg-white dark:text-white text-black rounded-xl shadow-md dark:shadow-zinc-800 transition-colors duration-200">
      <h2 className="text-2xl font-bold text-center border-b dark:border-white border-black pb-4">Stealth Transfer</h2>
      
      {/* Receiver Address Input */}
      <div className="form-control w-full">
        <label className="label">
          <span className="label-text dark:text-gray-300 text-gray-700">Recipient (network prefixed)</span>
        </label>
        <div className="relative">
          <input
            type="text"
            placeholder="eth:name.eth or eth:0x... or sep:0x..."
            className={`input input-bordered w-full pr-10 font-mono 
              dark:bg-zinc-900 dark:border-white dark:text-white 
              bg-gray-100 border-gray-300 text-black
              transition-colors duration-200
              ${receiverInput && !isValidReceiverInput ? "!border-red-500" : ""}
            `}
            value={receiverInput}
            onChange={e => setReceiverInput(e.target.value)}
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
            <ReceiverStatusIndicator />
          </div>
        </div>
        {/* Status messages for address input */}
        
        {/* ENS resolution status */}
        {receiverInput && parsedReceiver.isEns && isResolvingEns && (
          <label className="label">
            <span className="label-text-alt dark:text-gray-400 text-gray-600 font-mono text-xs animate-pulse">
              Resolving ENS name...
            </span>
          </label>
        )}
        
        {/* Meta address lookup status */}
        {receiverInput && isLoadingMeta && (
          <label className="label">
            <span className="label-text-alt dark:text-gray-400 text-gray-600 font-mono text-xs animate-pulse">
              Looking up stealth meta address...
            </span>
          </label>
        )}
        
        {/* Error messages - only show when not loading */}
        {receiverInput && !isLoadingMeta && !isResolvingEns && !isValidReceiverInput && (
          <label className="label">
            <span className="label-text-alt dark:text-red-400 text-red-600 font-mono text-xs">
              {!parsedReceiver.networkPrefix 
                ? "Use 'eth:' for Ethereum mainnet or 'sep:' for Sepolia testnet" 
                : parsedReceiver.isEns && !resolvedAddress
                  ? "Could not resolve ENS name"
                  : "Please enter a valid Ethereum address or ENS name"}
            </span>
          </label>
        )}
        
        {/* Success message when meta address is found */}
        {isValidReceiverInput && !isLoadingMeta && !isResolvingEns && metaAddress && metaAddress !== "0x" && (
          <label className="label">
            <span className="label-text-alt dark:text-green-400 text-green-600 font-mono text-xs">
              Stealth addresses enabled ✓
            </span>
          </label>
        )}
        
        {/* "Not registered" error message */}
        {isValidReceiverInput && !isLoadingMeta && !isResolvingEns && metaAddress === "0x" && (
          <label className="label">
            <span className="label-text-alt dark:text-red-400 text-red-600 font-mono text-xs">
              Not registered on stealth addresses protocol
            </span>
          </label>
        )}
      </div>

      {/* Token Selection - Only show if we have a confirmed valid address with stealth meta */}
      {isValidReceiverInput && !isLoadingMeta && !isResolvingEns && metaAddress && metaAddress !== "0x" && (
        <div className="form-control w-full">
          <label className="label">
            <span className="label-text dark:text-gray-300 text-gray-700">Token</span>
          </label>
          
          {!showCustomTokenInput ? (
            <div className="dropdown w-full">
              <label tabIndex={0} className="btn btn-block justify-between dark:bg-zinc-900 dark:text-white dark:border-white dark:hover:bg-zinc-800 bg-gray-100 text-black border-gray-300 hover:bg-gray-200 transition-colors duration-200">
                {selectedToken ? (
                  <span className="font-mono">
                    {selectedToken.symbol} ({selectedToken.name})
                  </span>
                ) : (
                  <span className="font-mono">Select Token</span>
                )}
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </label>
              <ul ref={tokenDropdownRef} tabIndex={0} className="dropdown-content menu p-2 shadow dark:bg-black bg-white dark:border-white border-gray-300 border rounded-box w-full z-10 max-h-96 overflow-y-auto">
                <li>
                  <a onClick={handleCustomTokenOption} className="dark:text-white text-black font-mono dark:hover:bg-zinc-800 hover:bg-gray-200 transition-colors duration-200">
                    <span>Custom Token</span>
                  </a>
                </li>
                <li className="menu-title dark:text-gray-400 text-gray-600 pt-2">Common Tokens</li>
                {availableTokens.map((token) => (
                  <li key={token.address}>
                    <a onClick={() => handleTokenSelect(token)} className="dark:text-white text-black dark:hover:bg-zinc-800 hover:bg-gray-200 transition-colors duration-200">
                      <span className="font-mono">{token.symbol}</span>
                      <span className="text-xs dark:text-gray-400 text-gray-600 font-mono">{token.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                placeholder={`0x... or ${parsedReceiver.networkPrefix}:0x...`}
                className={`input input-bordered w-full pr-10 font-mono 
                  dark:bg-zinc-900 dark:border-white dark:text-white 
                  bg-gray-100 border-gray-300 text-black
                  transition-colors duration-200
                  ${customTokenAddress && !isAddress(customTokenAddress.replace(/^(eth|sep):/, '')) ? "!border-red-500" : ""}
                `}
                value={customTokenAddress}
                onChange={e => setCustomTokenAddress(e.target.value)}
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <div className="flex items-center justify-center w-5 h-5">
                  <TokenStatusIndicator />
                </div>
              </div>
              {customTokenAddress && !isAddress(customTokenAddress.replace(/^(eth|sep):/, '')) && (
                <label className="label">
                  <span className="label-text-alt dark:text-red-400 text-red-600 font-mono text-xs">
                    Please enter a valid token contract address
                  </span>
                </label>
              )}
              <div className="flex justify-end mt-2">
                <button 
                  className="btn btn-sm dark:bg-zinc-900 dark:text-white dark:border-white dark:hover:bg-zinc-800 bg-gray-100 text-black border-gray-300 hover:bg-gray-200 font-mono transition-colors duration-200" 
                  onClick={() => {
                    setShowCustomTokenInput(false);
                    setCustomTokenAddress("");
                  }}
                >
                  Back to List
                </button>
              </div>
            </div>
          )}
          
          {tokenError && (
            <label className="label">
              <span className="label-text-alt dark:text-red-400 text-red-600 font-mono text-xs">{tokenError}</span>
            </label>
          )}
          
          {selectedToken && (
            <div className="mt-4 text-sm dark:text-gray-300 text-gray-700 border-t dark:border-zinc-800 border-gray-200 pt-4">
              <div className="flex justify-between">
                <span className="font-mono">Symbol:</span>
                <span className="font-mono">{selectedToken.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono">Name:</span>
                <span className="font-mono">{selectedToken.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono">Decimals:</span>
                <span className="font-mono">{selectedToken.decimals === 0 && selectedToken.isERC721 ? "-" : selectedToken.decimals}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono">Type:</span>
                <span className="font-mono">{selectedToken.isERC721 ? "NFT (ERC721)" : selectedToken.address !== "NATIVE" ? "Token (ERC20)" : "Token (native)"}</span>
              </div>
              
              {/* Value Input */}
              <div className="mt-4 border-t dark:border-zinc-800 border-gray-200 pt-4">
                <label className="label">
                  <span className="label-text dark:text-gray-300 text-gray-700">{selectedToken.isERC721 ? "Token ID" : "Amount"}</span>
                </label>
                <input
                  type="text"
                  placeholder={selectedToken.isERC721 ? "Enter token ID" : `Enter amount (${selectedToken.symbol})`}
                  className={`input input-bordered w-full font-mono 
                    dark:bg-zinc-900 dark:border-white dark:text-white 
                    bg-gray-100 border-gray-300 text-black
                    transition-colors duration-200
                    ${valueError ? "!border-red-500" : ""}
                  `}
                  value={valueInput}
                  onChange={e => setValueInput(e.target.value)}
                />
                {valueError && (
                  <label className="label">
                    <span className="label-text-alt dark:text-red-400 text-red-600 font-mono text-xs">{valueError}</span>
                  </label>
                )}
                {processedValue !== null && !valueError && (
                  <label className="label">
                    <span className="label-text-alt dark:text-gray-400 text-gray-600 font-mono text-xs">
                      {selectedToken.isERC721 
                        ? `Valid token ID: ${processedValue.toString()}`
                        : `${valueInput} ${selectedToken.symbol} = ${processedValue.toString()} wei`}
                    </span>
                  </label>
                )}
                
                {/* Action Button */}
                {processedValue !== null && !valueError && (
                  <div className="mt-4">
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
                      <div>
                        <button 
                          className={`btn w-full dark:bg-white dark:text-black dark:hover:bg-gray-300 bg-black text-white hover:bg-gray-800 border-0 font-mono transition-colors duration-200 ${isApproving || isTransferring ? 'opacity-70' : ''}`}
                          disabled={!isCorrectNetwork() || isApproving || isTransferring}
                          onClick={!isApproved && !(selectedToken.address==="NATIVE") ? handleApprove : !isTransfered ? handleTransfer : handleRestart}
                        >
                          {isApproving ? "Approving..." :
                          !isCorrectNetwork() ? "Switch Network" : 
                          !isApproved && !(selectedToken.address==="NATIVE") ? "Approve" :
                          isTransferring ? "Transferring..." : !isTransfered ? "Transfer" : "Restart"
                          }
                        </button>
                        {/* Show checking message only when we're actively checking and not completed */}
                        {isConnected && processedValue && selectedToken && 
                         selectedToken.address !== "NATIVE" && isCheckingApprovalRef.current && 
                         !approvalCheckCompletedRef.current && (
                          <div className="mt-2 text-xs dark:text-gray-400 text-gray-600 font-mono animate-pulse">
                            Checking approval status...
                          </div>
                        )}
                      </div>
                    )}
                    
                    {approvalError && (
                      <div className="mt-2">
                        <span className="dark:text-red-400 text-red-600 text-xs font-mono">{approvalError}</span>
                      </div>
                    )}
                    
                    {transferError && (
                      <div className="mt-2">
                        <span className="dark:text-red-400 text-red-600 text-xs font-mono">{transferError}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {metaError && (
        <div className="alert dark:bg-black bg-white dark:border-red-500 border-red-600 dark:text-red-400 text-red-600 font-mono text-sm transition-colors duration-200">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{metaError}</span>
        </div>
      )}

      {/* Help Text */}
      <div className="mt-6 text-sm dark:text-gray-400 text-gray-600 border-t dark:border-zinc-800 border-gray-200 pt-4">
        <p className="mb-2">
          Transfer tokens to a target recipient <i>identity</i>, but funds arrive to an <i>anonymous address</i> that keeps the recipient identity private to onchain observers.
        </p>
        <p>
          Only works for Registered recipients (see <Link href="/register" className="underline hover:text-primary">Register</Link> page)
        </p>
      </div>
    </div>
  );
};
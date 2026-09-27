import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatUnits,
  isAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { loadConfig, publicClient, type Config } from "./config";
import {
  amountIn,
  errorText,
  minimumOut,
  referral,
  switchChain,
} from "./domain";
import {
  quote,
  readActivity,
  readState,
  transact,
  verifyDeployment,
  type Activity,
  type State,
} from "./chain";
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const display = (value: bigint | undefined, decimals = 18) =>
  value === undefined
    ? "—"
    : value > 0n && Number(formatUnits(value, decimals)) < 0.00000001
      ? "<0.00000001"
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(
          Number(formatUnits(value, decimals)),
        );
function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" width="36" height="36">
      <path
        d="M8 28V12h13a8 8 0 0 1 0 16H8m13-16v16m-8-8h19"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        d="m27 15 5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
    </svg>
  );
}
export function App() {
  const [config, setConfig] = useState<Config>();
  const [bootError, setBootError] = useState("");
  useEffect(() => {
    let active = true;
    loadConfig()
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch((e) => {
        if (active) setBootError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, []);
  if (!config)
    return (
      <main className="boot">
        <Mark />
        <h1>Referral</h1>
        <p role={bootError ? "alert" : "status"}>
          {bootError || "Loading the verified deployment…"}
        </p>
        {bootError && (
          <button onClick={() => location.reload()}>Reload deployment</button>
        )}
      </main>
    );
  return <Dashboard config={config} />;
}
function Dashboard({ config: c }: { config: Config }) {
  const [account, setAccount] = useState<Address>();
  const [chain, setChain] = useState<number>();
  const [state, setState] = useState<State>();
  const [verified, setVerified] = useState(false);
  const [readError, setReadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Activity[]>([]);
  const [eventError, setEventError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hash>();
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [estimate, setEstimate] = useState<{
    output: bigint;
    minimum: bigint;
    input: bigint;
    data: Hex;
    expires: number;
    key: string;
  }>();
  const [now, setNow] = useState(Date.now());
  const [linkAddress, setLinkAddress] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linkStatus, setLinkStatus] = useState("");
  const lock = useRef(false),
    readVersion = useRef(0),
    session = useRef(0),
    formKey = useRef("");
  const provider = window.ethereum;
  const correctChain = chain === c.deployment.chainId;
  const client = useMemo(
    () => publicClient(c, correctChain ? provider : undefined),
    [c, provider, correctChain],
  );
  const ref = useMemo(
    () => referral(new URLSearchParams(location.search).get("ref"), c, account),
    [c, account],
  );
  const key = [account, chain, buy, amount, slippage, ref.data].join(":");
  formKey.current = key;
  const validQuote =
    estimate?.key === key && estimate.expires > now ? estimate : undefined;
  const explorer = c.deployment.network.explorer;
  const refresh = useCallback(async () => {
    const version = ++readVersion.current;
    setLoading(true);
    setReadError("");
    setVerified(false);
    try {
      await verifyDeployment(c, client);
      const next = await readState(c, client, account);
      if (version !== readVersion.current) return;
      setState(next);
      setVerified(true);
      try {
        const history = await readActivity(c, client, next.block);
        if (version === readVersion.current) {
          setEvents(history);
          setEventError("");
        }
      } catch (e) {
        if (version === readVersion.current)
          setEventError(`Activity could not load. ${errorText(e)}`);
      }
    } catch (e) {
      if (version === readVersion.current) {
        setReadError(errorText(e));
        setVerified(false);
      }
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, [c, client, account]);
  useEffect(() => {
    setState(undefined);
    setEstimate(undefined);
    void refresh();
    const t = setInterval(() => void refresh(), 30000);
    return () => {
      clearInterval(t);
      readVersion.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!provider) return;
    const accounts = (value: unknown) => {
      session.current++;
      const a = (value as string[])[0];
      setAccount(a && isAddress(a) ? a : undefined);
      setEstimate(undefined);
      setError("");
    };
    const chains = (value: unknown) => {
      session.current++;
      setChain(Number(value));
      setEstimate(undefined);
    };
    const disconnect = () => {
      accounts([]);
      setChain(undefined);
    };
    let active = true;
    Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ])
      .then(([a, id]) => {
        if (active) {
          accounts(a);
          chains(id);
        }
      })
      .catch(() => {});
    provider.on?.("accountsChanged", accounts);
    provider.on?.("chainChanged", chains);
    provider.on?.("disconnect", disconnect);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", accounts);
      provider.removeListener?.("chainChanged", chains);
      provider.removeListener?.("disconnect", disconnect);
    };
  }, [provider]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setHash(undefined);
    setStatus("");
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
      setStatus("");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function connect() {
    void run(async () => {
      if (!provider)
        throw Error(
          "No browser wallet found. Install an Ethereum wallet, then reload this page.",
        );
      const accounts = await provider.request({
        method: "eth_requestAccounts",
      });
      setAccount(accounts[0]);
      setChain(Number(await provider.request({ method: "eth_chainId" })));
      setStatus("Wallet connected.");
    });
  }
  function switchNetwork() {
    void run(async () => {
      if (!provider) return;
      await switchChain(provider, c);
      setChain(Number(await provider.request({ method: "eth_chainId" })));
      setStatus(`Wallet switched to ${c.chain.name}.`);
    });
  }
  const ready = !!account && correctChain && verified && !busy && !loading;
  const initialized = !!state && state.sqrtPrice > 0n;
  const linkValid = isAddress(linkAddress) && referral(linkAddress, c).valid;
  const referralLink = useMemo(() => {
    if (!linkValid) return "";
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("ref", linkAddress);
    return url.href;
  }, [linkValid, linkAddress]);
  let inputError = "";
  let parsed = 0n;
  try {
    parsed = amountIn(
      amount,
      buy ? 18 : (state?.decimals ?? c.deployment.token.decimals),
    );
  } catch (e) {
    inputError = errorText(e);
  }
  let slippageError = "";
  try {
    minimumOut(10000n, slippage);
  } catch (e) {
    slippageError = errorText(e);
  }
  const enough =
    state &&
    parsed <= (buy ? (state.ethBalance ?? 0n) : (state.tokenBalance ?? 0n));
  const needsToken =
    !buy && !!validQuote && (state?.tokenAllowance ?? 0n) < validQuote.input;
  const needsRouter =
    !buy &&
    !!validQuote &&
    ((state?.routerAllowance ?? 0n) < validQuote.input ||
      (state?.expiration ?? 0) < now / 1000 + 300);
  const buttonLabel = !account
    ? "Connect wallet to swap"
    : !correctChain
      ? `Switch to ${c.chain.name}`
      : !validQuote
        ? "Get quote"
        : needsToken
          ? "1. Approve REFR"
          : needsRouter
            ? "2. Authorize router"
            : `Confirm ${buy ? "buy" : "sell"}`;
  function swap() {
    if (inputError || slippageError) {
      setError(inputError || slippageError);
      setStatus("");
      document.getElementById(inputError ? "amount" : "slippage")?.focus();
      return;
    }
    void run(async () => {
      if (!provider || !account || !correctChain || !verified || !initialized)
        throw Error(
          "Connect on the correct network and refresh the pool before swapping.",
        );
      if (!enough)
        throw Error(
          `Insufficient ${buy ? "ETH" : "REFR"} balance. Reduce the amount. Keep ETH for network fees.`,
        );
      const snapshot = session.current,
        originalKey = key;
      if (!validQuote) {
        setStatus("Getting a live quote…");
        const output = await quote(c, client, account, buy, parsed, ref.data);
        if (snapshot !== session.current || formKey.current !== originalKey)
          return;
        setEstimate({
          output,
          minimum: minimumOut(output, slippage),
          input: parsed,
          data: ref.data,
          expires: Date.now() + 30000,
          key,
        });
        setStatus("Quote ready. Review the amounts before continuing.");
        return;
      }
      const action = needsToken
        ? "tokenApproval"
        : needsRouter
          ? "routerApproval"
          : "swap";
      await transact(
        c,
        client,
        provider,
        account,
        action,
        validQuote.input,
        buy,
        validQuote.minimum,
        validQuote.data,
        (s, h) => {
          setStatus(s);
          if (h) setHash(h);
        },
      );
      setEstimate(undefined);
      if (action === "swap") setAmount("");
      await refresh();
    });
  }
  function claim() {
    void run(async () => {
      if (
        !provider ||
        !account ||
        !correctChain ||
        !verified ||
        !state?.claimable
      )
        throw Error("Connect and load a claimable balance first.");
      await transact(
        c,
        client,
        provider,
        account,
        "claim",
        0n,
        true,
        0n,
        "0x",
        (s, h) => {
          setStatus(s);
          if (h) setHash(h);
        },
      );
      await refresh();
    });
  }
  const statusText = loading
    ? "Checking deployment…"
    : verified
      ? "Deployment verified"
      : "Connection unavailable";
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header wrap">
        <a className="brand" href="./" aria-label="Referral home">
          <Mark />
          Referral<span className="brand-note">a shared upside</span>
        </a>
        <div className="wallet-bar">
          <span className="badge">
            <span className="dot" />
            {c.chain.name} testnet
          </span>
          <button
            className="wallet-button"
            disabled={busy}
            onClick={
              account
                ? () => {
                    session.current++;
                    setAccount(undefined);
                    setEstimate(undefined);
                    setStatus("Wallet disconnected from this page.");
                  }
                : connect
            }
          >
            {account ? (
              <>
                <span title={account}>{short(account)}</span>
                <span className="small">Disconnect</span>
              </>
            ) : (
              "Connect wallet"
            )}
            <Arrow />
          </button>
        </div>
      </header>
      <main id="main" className="wrap">
        <section className="intro">
          <div>
            <p className="eyebrow">A little referral. A shared reward.</p>
            <h1>
              Share the link.
              <br />
              <span>Share the upside.</span>
            </h1>
            <p className="intro-copy">
              Trade REFR, invite someone along, and earn ETH from their swaps.
              Simple by design. Settled onchain.
            </p>
          </div>
          <div className="intro-note">
            <span className="number">
              0.2<span>%</span>
            </span>
            <p>
              of the ETH fee base goes
              <br />
              to a valid referrer.
            </p>
            <span className="small">No referrer? No referral fee.</span>
          </div>
        </section>
        <div className="network-row">
          <span>
            <span className={`dot ${verified ? "good" : ""}`} />
            {statusText}
            {state && ` · Block ${state.block.toLocaleString()}`}
          </span>
          <button
            className="text-button"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh data"}{" "}
            <span aria-hidden="true">↻</span>
          </button>
        </div>
        {account && !correctChain && (
          <div className="notice">
            Your wallet is on another network.
            <button disabled={busy} onClick={switchNetwork}>
              Switch to {c.chain.name}
            </button>
          </div>
        )}
        {readError && (
          <p className="error" role="alert">
            {readError} Use Refresh data to retry.
          </p>
        )}
        <div className="dashboard">
          <section className="card swap-card" aria-labelledby="swap-heading">
            <div className="section-heading">
              <h2 id="swap-heading">Make a swap</h2>
              <span className="pill">ETH / REFR</span>
            </div>
            <p className="muted">Test tokens. Real onchain interactions.</p>
            <div className="segmented" role="group" aria-label="Swap direction">
              <button
                disabled={busy}
                aria-pressed={buy}
                onClick={() => {
                  setBuy(true);
                  setEstimate(undefined);
                }}
              >
                Buy REFR
              </button>
              <button
                disabled={busy}
                aria-pressed={!buy}
                onClick={() => {
                  setBuy(false);
                  setEstimate(undefined);
                }}
              >
                Sell REFR
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!account) connect();
                else if (!correctChain) switchNetwork();
                else swap();
              }}
            >
              <div className="amount-box">
                <div className="field-top">
                  <label htmlFor="amount">You pay</label>
                  <span>
                    Balance:{" "}
                    {display(
                      buy ? state?.ethBalance : state?.tokenBalance,
                      state?.decimals ?? 18,
                    )}
                  </span>
                </div>
                <div className="amount-row">
                  <input
                    id="amount"
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    disabled={busy}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setEstimate(undefined);
                    }}
                    aria-describedby="amount-hint"
                    aria-invalid={amount !== "" && !!inputError}
                  />
                  <span className="currency">
                    <span
                      className={`coin ${buy ? "eth" : ""}`}
                      aria-hidden="true"
                    >
                      {buy ? "Ξ" : "R"}
                    </span>
                    {buy ? "ETH" : "REFR"}
                  </span>
                </div>
              </div>
              <div className="direction-arrow" aria-hidden="true">
                ↓
              </div>
              <div className="amount-box output">
                <span className="small">You receive · estimated</span>
                <div className="amount-row">
                  <output aria-label="Estimated output">
                    {validQuote
                      ? display(
                          validQuote.output,
                          buy ? (state?.decimals ?? 18) : 18,
                        )
                      : "—"}
                  </output>
                  <span className="currency">
                    <span
                      className={`coin ${!buy ? "eth" : ""}`}
                      aria-hidden="true"
                    >
                      {buy ? "R" : "Ξ"}
                    </span>
                    {buy ? "REFR" : "ETH"}
                  </span>
                </div>
              </div>
              <p
                id="amount-hint"
                className={
                  amount && inputError ? "field-error small" : "small muted"
                }
              >
                {amount && inputError
                  ? inputError
                  : "Exact input. Keep some ETH for network fees."}
              </p>
              <div className="slippage">
                <label htmlFor="slippage">Slippage tolerance</label>
                <div>
                  <input
                    id="slippage"
                    name="slippage"
                    inputMode="decimal"
                    value={slippage}
                    disabled={busy}
                    onChange={(e) => {
                      setSlippage(e.target.value);
                      setEstimate(undefined);
                    }}
                    aria-describedby="slippage-hint"
                    aria-invalid={!!slippageError}
                  />
                  <span>%</span>
                </div>
              </div>
              <p
                id="slippage-hint"
                className={slippageError ? "field-error small" : "sr-only"}
              >
                {slippageError || "Choose from 0.1 to 5 percent."}
              </p>
              <dl className="trade-details">
                <div>
                  <dt>Pool fee</dt>
                  <dd>{c.deployment.pool.fee / 10000}%</dd>
                </div>
                <div>
                  <dt>Referral fee</dt>
                  <dd>
                    {ref.valid
                      ? (Number(state?.feeBps ?? 20n) / 100).toString()
                      : "0"}
                    %
                  </dd>
                </div>
                {validQuote && (
                  <>
                    <div>
                      <dt>Minimum received</dt>
                      <dd>
                        {formatUnits(
                          validQuote.minimum,
                          buy ? (state?.decimals ?? 18) : 18,
                        )}{" "}
                        {buy ? "REFR" : "ETH"}
                      </dd>
                    </div>
                    <div>
                      <dt>Quote expires in</dt>
                      <dd>
                        {Math.max(
                          0,
                          Math.ceil((validQuote.expires - now) / 1000),
                        )}
                        s
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <div className="referrer-note">
                <span aria-hidden="true">↳</span>
                <div>
                  {ref.message}
                  {ref.address && (
                    <a
                      href={`${explorer}/address/${ref.address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {ref.address}
                    </a>
                  )}
                </div>
              </div>
              <button
                className="primary full"
                type="submit"
                disabled={
                  busy ||
                  (!!account &&
                    correctChain &&
                    (!verified || loading || !initialized))
                }
              >
                {busy ? "Waiting…" : buttonLabel}
                <Arrow />
              </button>
              {!initialized && state && (
                <p className="small muted">
                  The pool is not initialized. Swaps are unavailable.
                </p>
              )}
              {validQuote && !buy && (
                <p className="small muted">
                  Two approvals may be required: REFR to Permit2, then Permit2
                  to the router. Each is limited to this amount; router
                  authorization expires in one hour.
                </p>
              )}
              <p className="form-footnote">
                Quotes include pool and referral fees. A swap is simulated
                before your wallet asks you to sign.
              </p>
            </form>
          </section>
          <div className="right-column">
            <section className="card link-card" aria-labelledby="link-heading">
              <div className="section-heading">
                <h2 id="link-heading">Good things travel.</h2>
                <span className="link-symbol" aria-hidden="true">
                  ↗
                </span>
              </div>
              <p>
                Make a referral link. When someone trades through it, their
                referral fee is credited to you.
              </p>
              <label htmlFor="ref-address">Your referral address</label>
              <div className="link-entry">
                <input
                  id="ref-address"
                  name="referrer"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="0x…"
                  value={linkAddress}
                  aria-invalid={!!linkError}
                  aria-describedby="link-error"
                  onChange={(e) => {
                    setLinkAddress(e.target.value);
                    setLinkError("");
                    setLinkStatus("");
                  }}
                />
                <button
                  disabled={!account}
                  onClick={() => {
                    setLinkAddress(account!);
                    setLinkError("");
                    setLinkStatus("");
                  }}
                >
                  Use wallet
                </button>
              </div>
              <p id="link-error" className="field-error">
                {linkError}
              </p>
              {referralLink && (
                <div className="generated-link">
                  <label htmlFor="generated-link">Your shareable link</label>
                  <input
                    id="generated-link"
                    readOnly
                    value={referralLink}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              )}
              <button
                className="dark-button"
                onClick={async () => {
                  if (!linkValid) {
                    setLinkError(
                      "Enter a valid Ethereum address that can receive referral rewards.",
                    );
                    document.getElementById("ref-address")?.focus();
                    return;
                  }
                  try {
                    await navigator.clipboard.writeText(referralLink);
                    setLinkStatus("Referral link copied.");
                  } catch {
                    setLinkStatus("Select and copy the shareable link above.");
                  }
                }}
              >
                Copy referral link <span aria-hidden="true">↗</span>
              </button>
              <p className="small" role="status">
                {linkStatus || "No sign-up. No signature. Just your address."}
              </p>
            </section>
            <section
              className="card earnings-card"
              aria-labelledby="earnings-heading"
            >
              <div className="section-heading">
                <h2 id="earnings-heading">Your referral earnings</h2>
                <span className="pill">Paid in ETH</span>
              </div>
              <p className="muted">
                {account
                  ? "Across all pools using this hook."
                  : "Connect your wallet to see your rewards."}
              </p>
              <div className="earnings">
                <span className="small muted">Available to claim</span>
                <div
                  className="earnings-number"
                  title={
                    state?.claimable !== undefined
                      ? formatUnits(state.claimable, 18)
                      : undefined
                  }
                >
                  {display(state?.claimable)} <span>ETH</span>
                </div>
              </div>
              <div className="earnings-stats">
                <div>
                  <span className="small muted">Referred swaps</span>
                  <strong>{state?.count?.toLocaleString() ?? "—"}</strong>
                </div>
                <div>
                  <span className="small muted">Referred ETH volume</span>
                  <strong>{display(state?.volume)}</strong>
                </div>
              </div>
              <button
                className="outline full"
                disabled={!ready || !state?.claimable}
                onClick={claim}
              >
                Claim all ETH <Arrow />
              </button>
              <p className="small muted">
                {account && state?.claimable === 0n
                  ? "No rewards to claim yet. Share your link to get started."
                  : "Claim your full balance to the connected wallet. Network fees apply."}
              </p>
            </section>
          </div>
        </div>
        <div className="action-feedback" aria-live="polite" role="status">
          {status}
          {hash && (
            <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
              View transaction <Arrow />
            </a>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        <section className="pool-strip" aria-label="Live pool state">
          <div>
            <span className="eyebrow">The pool at a glance</span>
            <strong>Referral / Ether</strong>
          </div>
          <div>
            <span className="small muted">Live pool price</span>
            <strong>
              {state && state.sqrtPrice > 0n
                ? new Intl.NumberFormat("en-US", {
                    maximumFractionDigits: 3,
                  }).format(Number(state.price))
                : "—"}{" "}
              <span className="small">REFR per ETH</span>
            </strong>
          </div>
          <div>
            <span className="small muted">Fixed token supply</span>
            <strong>
              {state ? display(state.totalSupply, state.decimals) : "—"}{" "}
              <span className="small">REFR</span>
            </strong>
          </div>
          <div>
            <span className="small muted">Liquidity</span>
            <strong>
              {state
                ? state.liquidity > 0n
                  ? "Active at current tick"
                  : "Quote to check range"
                : "Loading…"}
            </strong>
          </div>
        </section>
        <section
          className="activity-section"
          aria-labelledby="activity-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Onchain, in the open</p>
              <h2 id="activity-heading">Recent activity</h2>
            </div>
            <a
              href={`${explorer}/address/${c.hook.address}#events`}
              target="_blank"
              rel="noreferrer"
            >
              View all events <Arrow />
            </a>
          </div>
          <p className="small muted">
            Latest 2,000 blocks · all referrers · updates every 30 seconds
          </p>
          {eventError ? (
            <p className="error">{eventError} Use Refresh data to retry.</p>
          ) : events.length ? (
            <ul className="activity-list">
              {events.map((event) => (
                <li key={`${event.tx}-${event.index}`}>
                  <span className="event-icon" aria-hidden="true">
                    {event.type === "Referred" ? "↗" : "↓"}
                  </span>
                  <div>
                    <strong>
                      {event.type === "Referred"
                        ? "Referral earned"
                        : "Rewards claimed"}
                    </strong>
                    <a
                      href={`${explorer}/address/${event.referrer}`}
                      target="_blank"
                      rel="noreferrer"
                      title={event.referrer}
                    >
                      {short(event.referrer)}
                    </a>
                  </div>
                  <span
                    className="event-value"
                    title={formatUnits(event.amount, 18)}
                  >
                    {display(event.amount)} ETH
                  </span>
                  <a
                    href={`${explorer}/tx/${event.tx}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View ${event.type} transaction ${event.tx}`}
                  >
                    Block {event.block.toLocaleString()} <Arrow />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              {loading
                ? "Loading hook events…"
                : "No referral events in the latest 2,000 blocks. Share a link to start the next one."}
            </div>
          )}
        </section>
        <section className="details-section">
          <details>
            <summary>How rewards and fees work</summary>
            <p>
              A valid referral earns {Number(state?.feeBps ?? 20n) / 100}% of
              the swap’s ETH fee base. There is no protocol cut. Without a valid
              referral, the hook charges no fee. The pool fee still applies.
            </p>
            <p>
              Referral data comes from the address in the URL and is encoded
              into hookData. It is unauthenticated: the swapper chooses whom to
              pay. The hook excludes the transaction origin, the zero address,
              itself and the PoolManager. A second wallet can bypass the
              self-referral check; it does not create extra rewards.
            </p>
            <p>
              Rewards and counts aggregate across supported pools. A partial
              fill reverts. Dust rewards round down to zero. Claims pay the
              entire available balance once; a receiving contract that rejects
              ETH cannot claim.
            </p>
          </details>
          <details>
            <summary>Deployment &amp; contracts</summary>
            <p className="small">
              Source commit <code>{c.deployment.sourceCommit}</code>
            </p>
            {c.deployment.contracts.map((contract) => (
              <p key={contract.name}>
                <a
                  href={`${explorer}/address/${contract.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {contract.name} <Arrow />
                </a>
                <code>{contract.address}</code>
              </p>
            ))}
            <p>
              <a
                href={`${explorer}/address/${c.deployment.network.uniswapV4.universalRouter}`}
                target="_blank"
                rel="noreferrer"
              >
                Uniswap Universal Router <Arrow />
              </a>
            </p>
            <p>
              <a
                href={`${explorer}/address/${c.deployment.network.uniswapV4.stateView}`}
                target="_blank"
                rel="noreferrer"
              >
                Uniswap StateView <Arrow />
              </a>
            </p>
            <a href="./imd-deployment.json">
              View deployment manifest <Arrow />
            </a>
          </details>
        </section>
      </main>
      <footer className="wrap">
        <span className="footer-brand">
          <Mark />
          Referral
        </span>
        <p>
          Built for a shared upside.{" "}
          <span className="muted">{c.chain.name} testnet only.</span>
        </p>
        <a
          href={c.deployment.network.faucets[0]}
          target="_blank"
          rel="noreferrer"
        >
          Get test ETH <Arrow />
        </a>
      </footer>
    </>
  );
}

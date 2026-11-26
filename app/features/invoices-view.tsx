"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Banknote,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CreditCard,
  FileCheck2,
  FileText,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Settings2,
  Unlink,
} from "lucide-react";
import type { AppState } from "../../lib/types";
import type {
  CardCycle,
  InvoiceInput,
  InvoiceKey,
  InvoicePayment,
  InvoicePaymentInput,
  InvoiceSummary,
} from "../../lib/invoice-types";
import { invoiceSummaries, paymentCandidates } from "../../lib/invoices";
import { formatMoney, monthLabel } from "../../lib/finance";
import { FeatureDialog } from "./feature-dialog";
import "./invoices.css";

interface Props {
  data: AppState;
  month: string;
  busy: boolean;
  onSaveCycle: (
    sourceId: string,
    input: Pick<CardCycle, "closingDay" | "dueDay">,
  ) => Promise<void>;
  onSaveInvoice: (input: InvoiceInput) => Promise<void>;
  onAllocate: (key: InvoiceKey, input: InvoicePaymentInput) => Promise<void>;
  onUnlink: (id: string) => Promise<void>;
  onNavigate: (tab: "sources" | "imports" | "reserve") => void;
}

type Editor = {
  kind: "cycle" | "total" | "payment" | "detail";
  sourceId: string;
} | null;
const statusLabels: Record<InvoiceSummary["status"], string> = {
  unverified: "A conferir",
  open: "Em aberto",
  partial: "Pagamento parcial",
  paid: "Quitada pelos vínculos",
};

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
function decimal(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
function parseCents(value: string): number | null {
  let normalized = value
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "");
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(normalized))
    normalized = normalized.replace(/\./g, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) &&
    result >= 0 &&
    result <= 1_000_000_000_000
    ? result
    : null;
}
function failure(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";
}
function ErrorNote({ error }: { error: string }) {
  return error ? (
    <p className="invoices-error" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      {error}
    </p>
  ) : null;
}

export function InvoicesView(props: Props) {
  return (
    <InvoicesContent key={`${props.data.user.id}:${props.month}`} {...props} />
  );
}

function InvoicesContent({
  data,
  month,
  busy,
  onSaveCycle,
  onSaveInvoice,
  onAllocate,
  onUnlink,
  onNavigate,
}: Props) {
  const invoices = invoiceSummaries(data, month);
  const [editor, setEditor] = useState<Editor>(null);
  const [remove, setRemove] = useState<InvoicePayment | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const waiting = busy || submitting;
  const selected = invoices.find(
    (invoice) => invoice.sourceId === editor?.sourceId,
  );
  const totalCents = invoices.reduce(
    (total, invoice) => total + invoice.totalCents,
    0,
  );
  const paidCents = invoices.reduce(
    (total, invoice) => total + invoice.paidCents,
    0,
  );
  const remainingCents = invoices.reduce(
    (total, invoice) => total + invoice.remainingCents,
    0,
  );
  const toCheck = invoices.filter((invoice) => !invoice.confirmed).length;

  async function run(action: () => Promise<void>, message: string) {
    if (pending.current || busy) return;
    pending.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (mounted.current) {
        setEditor(null);
        setRemove(null);
        setNotice(message);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }
  function open(kind: NonNullable<Editor>["kind"], sourceId: string) {
    setError("");
    setEditor({ kind, sourceId });
  }

  return (
    <div className="invoices-view">
      <div className="invoices-toolbar">
        <p>
          Compras e parcelas no mês da fatura. Vincule os pagamentos do extrato
          para acompanhar a quitação.
        </p>
        <button
          className="button secondary"
          onClick={() => onNavigate("reserve")}
        >
          <Banknote size={17} aria-hidden="true" />
          Quanto reservar
        </button>
      </div>
      {notice && (
        <p className="invoices-notice" role="status">
          <Check size={18} aria-hidden="true" />
          {notice}
        </p>
      )}
      <ErrorNote error={error} />

      {!invoices.length ? (
        <section className="panel invoices-empty">
          <span className="invoices-empty-icon">
            <CreditCard size={31} aria-hidden="true" />
          </span>
          <h2>Um lugar para as suas faturas</h2>
          <p>
            Adicione um cartão de crédito em Contas e saldos. Depois, importe a
            fatura para reunir compras, parcelas e estornos.
          </p>
          <button
            className="button primary"
            onClick={() => onNavigate("sources")}
          >
            Adicionar cartão
          </button>
        </section>
      ) : (
        <>
          <section className="invoices-summary" aria-label="Resumo das faturas">
            <article className="invoices-summary-main">
              <span>
                <CreditCard size={19} aria-hidden="true" />
                Saldo pendente nas faturas
              </span>
              <strong>{formatMoney(remainingCents)}</strong>
              <p>
                {monthLabel(month)} ·{" "}
                {invoices.length === 1
                  ? "1 cartão"
                  : `${invoices.length} cartões`}
              </p>
            </article>
            <article className="panel invoices-summary-stat">
              <span>Total das faturas</span>
              <strong>{formatMoney(totalCents)}</strong>
              <p>
                {toCheck
                  ? `${toCheck} ${toCheck === 1 ? "total a conferir" : "totais a conferir"}`
                  : "Totais conferidos por você"}
              </p>
            </article>
            <article className="panel invoices-summary-stat">
              <span>Pagamentos vinculados</span>
              <strong>{formatMoney(paidCents)}</strong>
              <p>Valores já associados às faturas</p>
            </article>
          </section>
          <section className="invoices-grid" aria-label="Faturas dos cartões">
            {invoices.map((invoice) => (
              <article
                className="panel invoice-card"
                key={invoice.sourceId}
                aria-label={invoice.source.name}
              >
                <header>
                  <span className="invoice-card-icon">
                    <CreditCard size={23} aria-hidden="true" />
                  </span>
                  <div>
                    <p>{invoice.source.institution}</p>
                    <h2>{invoice.source.name}</h2>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Configurar ciclo de ${invoice.source.name}`}
                    disabled={waiting}
                    onClick={() => open("cycle", invoice.sourceId)}
                  >
                    <Settings2 size={18} aria-hidden="true" />
                  </button>
                </header>
                <div className="invoice-card-status">
                  <span className={`invoice-status ${invoice.status}`}>
                    {invoice.status === "paid" && (
                      <CheckCheck size={15} aria-hidden="true" />
                    )}
                    {statusLabels[invoice.status]}
                  </span>
                  <span>
                    {invoice.confirmed
                      ? "Total conferido"
                      : "Total pelos lançamentos"}
                  </span>
                </div>
                <div className="invoice-card-balance">
                  <span>Saldo pendente</span>
                  <strong>{formatMoney(invoice.remainingCents)}</strong>
                </div>
                <dl className="invoice-card-totals">
                  <div>
                    <dt>Total da fatura</dt>
                    <dd>{formatMoney(invoice.totalCents)}</dd>
                  </div>
                  <div>
                    <dt>Pagamento vinculado</dt>
                    <dd>{formatMoney(invoice.paidCents)}</dd>
                  </div>
                </dl>
                {invoice.creditCents > 0 && (
                  <p className="invoice-credit">
                    <Check size={16} aria-hidden="true" />
                    Crédito de {formatMoney(invoice.creditCents)} nesta fatura.
                  </p>
                )}
                <div className="invoice-cycle">
                  {invoice.closingDate && invoice.dueDate ? (
                    <>
                      <p>
                        <CalendarDays size={16} aria-hidden="true" />
                        <span>
                          Fechamento previsto{" "}
                          <strong>{dateLabel(invoice.closingDate)}</strong>
                        </span>
                      </p>
                      <p>
                        <span
                          className="invoice-date-indent"
                          aria-hidden="true"
                        />
                        <span>
                          Vencimento previsto{" "}
                          <strong>{dateLabel(invoice.dueDate)}</strong>
                        </span>
                      </p>
                      {invoice.pastDue && invoice.remainingCents > 0 && (
                        <p className="invoice-past-due">
                          <CircleAlert size={16} aria-hidden="true" />
                          Vencimento passado, confira a quitação.
                        </p>
                      )}
                    </>
                  ) : (
                    <button
                      className="invoice-text-button"
                      disabled={waiting}
                      onClick={() => open("cycle", invoice.sourceId)}
                    >
                      <CalendarDays size={17} aria-hidden="true" />
                      Configurar fechamento e vencimento
                    </button>
                  )}
                </div>
                <div className="invoice-card-actions">
                  <button
                    className="button primary"
                    disabled={waiting}
                    onClick={() => open("payment", invoice.sourceId)}
                  >
                    <Link2 size={17} aria-hidden="true" />
                    Vincular pagamento
                  </button>
                  <button
                    className="button secondary"
                    disabled={waiting}
                    onClick={() => open("detail", invoice.sourceId)}
                  >
                    <FileText size={17} aria-hidden="true" />
                    Ver fatura
                  </button>
                </div>
                <button
                  className="invoice-check-total"
                  disabled={waiting}
                  onClick={() => open("total", invoice.sourceId)}
                >
                  <FileCheck2 size={17} aria-hidden="true" />
                  {invoice.confirmed
                    ? "Revisar total conferido"
                    : "Conferir total da fatura"}
                </button>
              </article>
            ))}
          </section>
        </>
      )}
      <p className="invoices-privacy">
        <LockKeyhole size={17} aria-hidden="true" />
        As faturas ficam no seu espaço pessoal, mesmo quando uma compra é
        compartilhada com o casal.
      </p>

      {selected && editor?.kind === "cycle" && (
        <FeatureDialog
          title="Configurar ciclo do cartão"
          onClose={() => {
            if (!waiting) setEditor(null);
          }}
        >
          <CycleForm
            invoice={selected}
            initial={data.cardCycles?.find(
              (cycle) => cycle.sourceId === selected.sourceId,
            )}
            busy={waiting}
            onCancel={() => setEditor(null)}
            onSave={(input) =>
              run(
                () => onSaveCycle(selected.sourceId, input),
                "Ciclo do cartão atualizado.",
              )
            }
          />
        </FeatureDialog>
      )}
      {selected && editor?.kind === "total" && (
        <FeatureDialog
          title="Conferir total da fatura"
          onClose={() => {
            if (!waiting) setEditor(null);
          }}
        >
          <TotalForm
            invoice={selected}
            busy={waiting}
            onCancel={() => setEditor(null)}
            onSave={(confirmedTotalCents) =>
              run(
                () =>
                  onSaveInvoice({
                    sourceId: selected.sourceId,
                    month,
                    confirmedTotalCents,
                  }),
                "Total da fatura atualizado.",
              )
            }
          />
        </FeatureDialog>
      )}
      {selected && editor?.kind === "payment" && (
        <FeatureDialog
          title="Vincular pagamento"
          onClose={() => {
            if (!waiting) setEditor(null);
          }}
        >
          <PaymentForm
            data={data}
            invoice={selected}
            busy={waiting}
            onCancel={() => setEditor(null)}
            onImport={() => onNavigate("imports")}
            onSave={(input) =>
              run(
                () => onAllocate({ sourceId: selected.sourceId, month }, input),
                "Pagamento vinculado à fatura.",
              )
            }
          />
        </FeatureDialog>
      )}
      {selected && editor?.kind === "detail" && (
        <FeatureDialog
          title="Detalhes da fatura"
          onClose={() => {
            if (!waiting) setEditor(null);
          }}
        >
          <div className="invoice-detail">
            <p className="invoice-dialog-name">{selected.source.name}</p>
            <p className="invoice-dialog-month">{monthLabel(month)}</p>
            <div className="invoice-detail-balance">
              <span>Saldo pendente</span>
              <strong>{formatMoney(selected.remainingCents)}</strong>
              <p>
                Total {formatMoney(selected.totalCents)} · Vinculado{" "}
                {formatMoney(selected.paidCents)}
              </p>
            </div>
            <div className="invoice-detail-toolbar">
              <button
                className="button secondary"
                disabled={waiting}
                onClick={() => open("total", selected.sourceId)}
              >
                <FileCheck2 size={17} aria-hidden="true" />
                Conferir total
              </button>
              <button
                className="button primary"
                disabled={waiting}
                onClick={() => open("payment", selected.sourceId)}
              >
                <Link2 size={17} aria-hidden="true" />
                Vincular pagamento
              </button>
            </div>
            <section
              className="invoice-detail-section"
              aria-label="Lançamentos da fatura"
            >
              <h3>Compras e estornos</h3>
              {selected.transactions.length ? (
                <ol className="invoice-transaction-list">
                  {[...selected.transactions]
                    .sort(
                      (a, b) =>
                        b.date.localeCompare(a.date) ||
                        a.description.localeCompare(b.description),
                    )
                    .map((transaction) => (
                      <li key={transaction.id}>
                        <div>
                          <strong>{transaction.description}</strong>
                          <p>
                            {dateLabel(transaction.date)} ·{" "}
                            {transaction.category}
                          </p>
                          {transaction.installmentCurrent &&
                            transaction.installmentTotal && (
                              <span className="invoice-row-tag">
                                Parcela {transaction.installmentCurrent} de{" "}
                                {transaction.installmentTotal}
                              </span>
                            )}
                          {transaction.shared && (
                            <span className="invoice-row-tag">
                              Compartilhada com o casal
                            </span>
                          )}
                        </div>
                        <b
                          className={
                            transaction.kind === "refund"
                              ? "invoice-refund"
                              : ""
                          }
                        >
                          {transaction.kind === "refund" ? "− " : ""}
                          {formatMoney(transaction.amountCents)}
                        </b>
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="invoice-detail-empty">
                  Nenhuma compra importada nesta fatura.
                </p>
              )}
              <p className="invoice-detail-footnote">
                Lançamentos importados:{" "}
                {formatMoney(selected.computedTotalCents)}.
                {selected.confirmed
                  ? " O total conferido pode incluir valores ainda ausentes dos arquivos."
                  : " Confira o total com o demonstrativo do cartão."}
              </p>
            </section>
            <section
              className="invoice-detail-section"
              aria-label="Pagamentos da fatura"
            >
              <h3>Pagamentos vinculados</h3>
              {selected.payments.length ? (
                <ol className="invoice-payment-list">
                  {selected.payments.map((payment) => (
                    <li key={payment.id}>
                      <div>
                        <strong>{payment.transaction.description}</strong>
                        <p>
                          {dateLabel(payment.transaction.date)} ·{" "}
                          {data.sources.find(
                            (source) =>
                              source.id === payment.transaction.sourceId,
                          )?.name ?? "Conta bancária"}
                        </p>
                        <b>{formatMoney(payment.amountCents)}</b>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Desvincular ${payment.transaction.description}`}
                        disabled={waiting}
                        onClick={() => {
                          setEditor(null);
                          setRemove(payment);
                        }}
                      >
                        <Unlink size={18} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="invoice-detail-empty">
                  Nenhum pagamento vinculado. Um pagamento importado só quita
                  esta fatura depois que você o associa.
                </p>
              )}
            </section>
            <p className="invoice-dialog-help">
              Conferir o total ou vincular um pagamento organiza a fatura. Essas
              ações não criam compras, despesas ou pagamentos no banco.
            </p>
          </div>
        </FeatureDialog>
      )}
      {remove && (
        <FeatureDialog
          title="Desvincular pagamento?"
          onClose={() => {
            if (!waiting) setRemove(null);
          }}
        >
          <p className="invoice-dialog-copy">
            O vínculo de <strong>{formatMoney(remove.amountCents)}</strong> será
            removido desta fatura. O lançamento bancário continua no seu
            histórico e poderá ser associado novamente.
          </p>
          <ErrorNote error={error} />
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={waiting}
              onClick={() => setRemove(null)}
            >
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={waiting}
              onClick={() => {
                void run(
                  () => onUnlink(remove.id),
                  "Pagamento desvinculado. O lançamento bancário foi mantido.",
                ).catch((err) => setError(failure(err)));
              }}
            >
              {waiting && (
                <LoaderCircle size={17} className="spin" aria-hidden="true" />
              )}
              Desvincular pagamento
            </button>
          </div>
        </FeatureDialog>
      )}
    </div>
  );
}

function CycleForm({
  invoice,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  invoice: InvoiceSummary;
  initial?: CardCycle;
  busy: boolean;
  onSave: (input: Pick<CardCycle, "closingDay" | "dueDay">) => Promise<void>;
  onCancel: () => void;
}) {
  const [closing, setClosing] = useState(
    initial ? String(initial.closingDay) : "",
  );
  const [due, setDue] = useState(initial ? String(initial.dueDay) : "");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const closingDay = Number(closing),
      dueDay = Number(due);
    if (
      ![closingDay, dueDay].every(
        (day) => Number.isInteger(day) && day >= 1 && day <= 31,
      )
    ) {
      setError("Informe dias entre 1 e 31.");
      return;
    }
    setError("");
    try {
      await onSave({ closingDay, dueDay });
    } catch (err) {
      setError(failure(err));
    }
  }
  return (
    <form className="invoice-form" onSubmit={submit}>
      <p className="invoice-dialog-name">{invoice.source.name}</p>
      <p className="invoice-dialog-copy">
        Informe os dias habituais do seu cartão. Eles serão usados para mostrar
        datas previstas; o demonstrativo do banco pode trazer datas diferentes.
      </p>
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="invoice-closing">
            Dia de fechamento
          </label>
          <input
            id="invoice-closing"
            type="number"
            min={1}
            max={31}
            step={1}
            inputMode="numeric"
            placeholder="Ex.: 3"
            value={closing}
            onChange={(event) => setClosing(event.target.value)}
            required
            disabled={busy}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="invoice-due">
            Dia de vencimento
          </label>
          <input
            id="invoice-due"
            type="number"
            min={1}
            max={31}
            step={1}
            inputMode="numeric"
            placeholder="Ex.: 10"
            value={due}
            onChange={(event) => setDue(event.target.value)}
            required
            disabled={busy}
          />
        </div>
      </div>
      <p className="invoice-dialog-help">
        Dias que não existem no mês usam o último dia. Alterar o ciclo preserva
        o mês das compras já importadas.
      </p>
      <ErrorNote error={error} />
      <FormActions busy={busy} onCancel={onCancel} label="Salvar ciclo" />
    </form>
  );
}

function TotalForm({
  invoice,
  busy,
  onSave,
  onCancel,
}: {
  invoice: InvoiceSummary;
  busy: boolean;
  onSave: (amount: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [automatic, setAutomatic] = useState(false);
  const [amount, setAmount] = useState(decimal(invoice.totalCents));
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const cents = automatic ? null : parseCents(amount);
    if (!automatic && cents === null) {
      setError(
        "Informe um total igual ou maior que zero, com até duas casas decimais.",
      );
      return;
    }
    setError("");
    try {
      await onSave(cents);
    } catch (err) {
      setError(failure(err));
    }
  }
  return (
    <form className="invoice-form" onSubmit={submit}>
      <p className="invoice-dialog-name">{invoice.source.name}</p>
      <p className="invoice-dialog-month">{monthLabel(invoice.month)}</p>
      <p className="invoice-dialog-copy">
        Confira o total no demonstrativo do cartão. Inclua os valores cobrados
        nele, mesmo que alguma linha ainda não tenha sido importada.
      </p>
      <div className="invoice-imported-total">
        <span>Total pelos lançamentos</span>
        <strong>{formatMoney(invoice.computedTotalCents)}</strong>
      </div>
      <label className="field-label" htmlFor="invoice-total">
        Total conferido (R$)
      </label>
      <input
        id="invoice-total"
        inputMode="decimal"
        value={
          automatic ? decimal(Math.max(0, invoice.computedTotalCents)) : amount
        }
        onChange={(event) => setAmount(event.target.value)}
        required={!automatic}
        disabled={busy || automatic}
      />
      <label className="invoice-checkbox">
        <input
          type="checkbox"
          checked={automatic}
          onChange={(event) => setAutomatic(event.target.checked)}
          disabled={busy}
        />
        Usar total pelos lançamentos
      </label>
      <p className="invoice-dialog-help">
        {automatic
          ? "A fatura volta a ficar a conferir. O total acompanhará os lançamentos importados."
          : "Conferir o total ajuda a acompanhar o saldo da fatura e a estimativa de reserva. Esse valor não cria uma despesa no histórico."}
      </p>
      <ErrorNote error={error} />
      <FormActions busy={busy} onCancel={onCancel} label="Salvar total" />
    </form>
  );
}

function PaymentForm({
  data,
  invoice,
  busy,
  onSave,
  onCancel,
  onImport,
}: {
  data: AppState;
  invoice: InvoiceSummary;
  busy: boolean;
  onSave: (input: InvoicePaymentInput) => Promise<void>;
  onCancel: () => void;
  onImport: () => void;
}) {
  const candidates = paymentCandidates(data, invoice);
  const [transactionId, setTransactionId] = useState(
    candidates[0]?.transaction.id ?? "",
  );
  const [amount, setAmount] = useState(() => {
    const first = candidates[0];
    if (!first) return "";
    return decimal(
      first.currentAllocationCents ||
        Math.min(invoice.remainingCents, first.availableCents),
    );
  });
  const [error, setError] = useState("");
  const candidate = candidates.find(
    (item) => item.transaction.id === transactionId,
  );
  const availableCents = candidate
    ? candidate.availableCents + candidate.currentAllocationCents
    : 0;
  function choose(id: string) {
    setTransactionId(id);
    setError("");
    const next = candidates.find((item) => item.transaction.id === id);
    setAmount(
      next
        ? decimal(
            next.currentAllocationCents ||
              Math.min(invoice.remainingCents, next.availableCents),
          )
        : "",
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const amountCents = parseCents(amount);
    if (!candidate) {
      setError("Escolha um pagamento do extrato bancário.");
      return;
    }
    if (amountCents === null || amountCents <= 0) {
      setError("Informe um valor maior que zero, com até duas casas decimais.");
      return;
    }
    if (amountCents > availableCents) {
      setError(
        "O valor supera a parte disponível deste pagamento. Confira os vínculos com outras faturas.",
      );
      return;
    }
    setError("");
    try {
      await onSave({ transactionId, amountCents });
    } catch (err) {
      setError(failure(err));
    }
  }
  return (
    <form className="invoice-form" onSubmit={submit}>
      <p className="invoice-dialog-name">{invoice.source.name}</p>
      <p className="invoice-dialog-month">{monthLabel(invoice.month)}</p>
      <p className="invoice-dialog-copy">
        Associe um pagamento que já aparece no extrato da sua conta bancária.
        Você pode dividir o valor entre faturas.
      </p>
      {candidates.length ? (
        <>
          <label className="field-label" htmlFor="invoice-payment">
            Pagamento do extrato
          </label>
          <div className="select-wrap">
            <select
              id="invoice-payment"
              value={transactionId}
              onChange={(event) => choose(event.target.value)}
              disabled={busy}
            >
              {candidates.map((item) => (
                <option key={item.transaction.id} value={item.transaction.id}>
                  {dateLabel(item.transaction.date)} ·{" "}
                  {item.transaction.description} ·{" "}
                  {formatMoney(
                    item.availableCents + item.currentAllocationCents,
                  )}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
          {candidate && (
            <div className="invoice-payment-availability">
              <span>
                {data.sources.find(
                  (source) => source.id === candidate.transaction.sourceId,
                )?.name ?? "Conta bancária"}
              </span>
              <p>
                Pagamento importado:{" "}
                <strong>
                  {formatMoney(candidate.transaction.amountCents)}
                </strong>
              </p>
              <p>
                Disponível para esta fatura:{" "}
                <strong>{formatMoney(availableCents)}</strong>
              </p>
            </div>
          )}
          <label className="field-label" htmlFor="invoice-payment-amount">
            Valor vinculado (R$)
          </label>
          <input
            id="invoice-payment-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={busy}
            required
          />
          <p className="invoice-dialog-help">
            Saldo pendente desta fatura: {formatMoney(invoice.remainingCents)}.
            Alterar um vínculo existente substitui o valor anterior. Um
            excedente será mostrado como crédito na fatura.
          </p>
          <ErrorNote error={error} />
          <FormActions
            busy={busy}
            onCancel={onCancel}
            label="Confirmar vínculo"
          />
        </>
      ) : (
        <div className="invoice-no-payments">
          <Banknote size={27} aria-hidden="true" />
          <h3>Nenhum pagamento bancário disponível</h3>
          <p>
            Importe o extrato da conta usada para pagar. O lançamento precisa
            estar classificado como Pagamento de fatura e ter valor ainda
            disponível para vincular.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onCancel}
            >
              Fechar
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={onImport}
            >
              Importar extrato
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function FormActions({
  busy,
  label,
  onCancel,
}: {
  busy: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="modal-actions">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={onCancel}
      >
        Cancelar
      </button>
      <button type="submit" className="button primary" disabled={busy}>
        {busy && <LoaderCircle size={17} className="spin" aria-hidden="true" />}
        {label}
      </button>
    </div>
  );
}

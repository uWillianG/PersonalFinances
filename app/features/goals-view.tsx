"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  History,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  PiggyBank,
  Plus,
  RotateCcw,
  ShieldCheck,
  Target,
  Trash2,
  UsersRound,
  Wallet,
} from "lucide-react";
import type { AppState } from "../../lib/types";
import type { PlanScope } from "../../lib/planning-types";
import type {
  GoalInput,
  GoalMovementInput,
  GoalPatch,
  SavingsGoal,
} from "../../lib/goals-types";
import { goalProgress, goalsSummary } from "../../lib/goals";
import { todayISO } from "../../lib/planning";
import { formatMoney } from "../../lib/finance";
import { FeatureDialog } from "./feature-dialog";
import "./goals.css";

interface Props {
  data: AppState;
  busy: boolean;
  onSave: (input: GoalInput | GoalPatch, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMovement: (goalId: string, input: GoalMovementInput) => Promise<void>;
  onOpenCouple: () => void;
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";
}
function centsFromInput(value: string) {
  let normalized = value
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "");
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(normalized))
    normalized = normalized.replace(/\./g, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ""] = normalized.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1_000_000_000_000
    ? cents
    : null;
}
function ErrorNote({ error }: { error: string }) {
  return error ? (
    <p className="goals-error" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      {error}
    </p>
  ) : null;
}

export function GoalsView({
  data,
  busy,
  onSave,
  onDelete,
  onMovement,
  onOpenCouple,
}: Props) {
  const [scope, setScope] = useState<PlanScope>("personal");
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<SavingsGoal | null | false>(false);
  const [movement, setMovement] = useState<{
    goalId: string;
    kind: GoalMovementInput["kind"];
  } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [remove, setRemove] = useState<SavingsGoal | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const waiting = busy || submitting;
  const goals = (data.goals ?? []).filter((goal) => goal.scope === scope);
  const movements = data.goalMovements ?? [];
  const visibleGoals = goals.filter((goal) => !goal.archived || showArchived);
  const archivedCount = goals.filter((goal) => goal.archived).length;
  const summary = goalsSummary(goals, movements);
  const detail = goals.find((goal) => goal.id === detailId);
  const movementGoal = goals.find((goal) => goal.id === movement?.goalId);
  const today = todayISO();

  async function run(
    action: () => Promise<void>,
    success: string,
    close?: () => void,
  ) {
    if (pending.current || busy) return;
    pending.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await action();
      close?.();
      setNotice(success);
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }
  function openMovement(goal: SavingsGoal, kind: GoalMovementInput["kind"]) {
    setDetailId(null);
    setError("");
    setMovement({ goalId: goal.id, kind });
  }
  function changeScope(next: PlanScope) {
    setScope(next);
    setError("");
    setNotice("");
    setShowArchived(false);
  }

  return (
    <div className="goals-view">
      <div className="goals-toolbar">
        <div
          className="scope-tabs"
          role="group"
          aria-label="Metas pessoais ou do casal"
        >
          <button
            className={scope === "personal" ? "selected" : ""}
            aria-pressed={scope === "personal"}
            onClick={() => changeScope("personal")}
          >
            <LockKeyhole size={16} aria-hidden="true" />
            Pessoais
          </button>
          <button
            className={scope === "couple" ? "selected" : ""}
            aria-pressed={scope === "couple"}
            onClick={() => changeScope("couple")}
          >
            <UsersRound size={17} aria-hidden="true" />
            Do casal
          </button>
        </div>
        <button
          className="button primary"
          disabled={waiting || (scope === "couple" && !data.couple)}
          onClick={() => {
            setError("");
            setEditor(null);
          }}
        >
          <Plus size={18} aria-hidden="true" />
          Nova meta
        </button>
      </div>

      <div className="goals-explainer">
        <PiggyBank size={20} aria-hidden="true" />
        <p>
          Separe uma intenção para o dinheiro que você já tem. Os aportes e
          resgates são registros virtuais: não fazem transferências nem alteram
          seus saldos, receitas ou despesas. O acompanhamento considera todo o
          histórico.
        </p>
      </div>
      {notice && (
        <p className="goals-notice" role="status">
          <Check size={18} aria-hidden="true" />
          {notice}
        </p>
      )}
      <ErrorNote error={error} />

      {scope === "couple" && !data.couple ? (
        <section className="panel goals-empty">
          <span className="goals-empty-icon">
            <UsersRound size={30} aria-hidden="true" />
          </span>
          <h2>Um objetivo de vocês dois</h2>
          <p>
            Conectem o casal para criar caixinhas em conjunto e acompanhar os
            aportes de cada um.
          </p>
          <button className="button primary" onClick={onOpenCouple}>
            Abrir nosso espaço
          </button>
          <span className="goals-privacy">
            <ShieldCheck size={17} aria-hidden="true" />
            Suas metas pessoais continuam privadas.
          </span>
        </section>
      ) : (
        <>
          <section className="goals-summary" aria-label="Resumo das caixinhas">
            <article className="goals-total">
              <span>
                <Wallet size={19} aria-hidden="true" />
                Reservado nas caixinhas
              </span>
              <strong>{formatMoney(summary.reservedCents)}</strong>
              <p>
                {archivedCount
                  ? "Inclui os valores das metas arquivadas."
                  : "Valor informado nos aportes, menos os resgates."}
              </p>
            </article>
            <article className="panel goals-stat">
              <span>Falta para os objetivos</span>
              <strong>{formatMoney(summary.remainingCents)}</strong>
              <p>Nas metas ativas</p>
            </article>
            <article className="panel goals-stat">
              <span>Metas ativas</span>
              <strong>{summary.activeCount}</strong>
              <p>
                {summary.achievedCount === 1
                  ? "1 objetivo alcançado"
                  : `${summary.achievedCount} objetivos alcançados`}
              </p>
            </article>
          </section>
          <div className="goals-list-heading">
            <div>
              <h2>
                {scope === "personal" ? "Seus objetivos" : "Objetivos do casal"}
              </h2>
              <p>
                {scope === "personal"
                  ? "Cada caixinha guarda uma prioridade sua."
                  : "Os dois podem editar as metas e registrar movimentos."}
              </p>
            </div>
            {archivedCount > 0 && (
              <label className="goals-archive-toggle">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                Mostrar arquivadas ({archivedCount})
              </label>
            )}
          </div>
          {visibleGoals.length === 0 ? (
            <section className="panel goals-empty">
              <span className="goals-empty-icon">
                <Target size={30} aria-hidden="true" />
              </span>
              <h2>
                {goals.length
                  ? "As metas estão arquivadas"
                  : "O próximo plano pode começar aqui"}
              </h2>
              <p>
                {goals.length
                  ? "Ative “Mostrar arquivadas” para consultar o histórico ou retomar um objetivo."
                  : "Uma reserva, uma viagem ou uma compra importante. Defina o valor e acompanhe o que já separou."}
              </p>
              {!goals.length && (
                <button
                  className="button secondary"
                  onClick={() => setEditor(null)}
                  disabled={waiting}
                >
                  <Plus size={17} aria-hidden="true" />
                  Criar primeira meta
                </button>
              )}
            </section>
          ) : (
            <section className="goals-grid" aria-label="Lista de metas">
              {visibleGoals.map((goal) => {
                const progress = goalProgress(goal, movements, today);
                return (
                  <article
                    className={`panel goals-card${goal.archived ? " goals-card-archived" : ""}`}
                    key={goal.id}
                    aria-label={goal.name}
                  >
                    <header>
                      <span className="goals-card-icon">
                        {progress.achieved ? (
                          <Check size={23} aria-hidden="true" />
                        ) : (
                          <PiggyBank size={23} aria-hidden="true" />
                        )}
                      </span>
                      <div>
                        <h3>{goal.name}</h3>
                        <span
                          className={`goals-status${progress.achieved ? " achieved" : ""}`}
                        >
                          {goal.archived
                            ? "Arquivada"
                            : progress.achieved
                              ? "Objetivo alcançado"
                              : "Em construção"}
                        </span>
                      </div>
                      {goal.canEdit && (
                        <button
                          className="icon-button"
                          aria-label={`Editar ${goal.name}`}
                          disabled={waiting}
                          onClick={() => setEditor(goal)}
                        >
                          <Pencil size={17} aria-hidden="true" />
                        </button>
                      )}
                    </header>
                    <div className="goals-card-values">
                      <strong>{formatMoney(progress.reservedCents)}</strong>
                      <span>de {formatMoney(goal.targetCents)}</span>
                    </div>
                    <div
                      className="goals-progress"
                      role="progressbar"
                      aria-label={`Progresso de ${goal.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress.percent)}
                      aria-valuetext={`${formatMoney(progress.reservedCents)} de ${formatMoney(goal.targetCents)}`}
                    >
                      <span style={{ width: `${progress.percent}%` }} />
                    </div>
                    <div className="goals-progress-note">
                      <span>{Math.round(progress.percent)}% do objetivo</span>
                      <span>
                        {progress.achieved
                          ? "Meta atingida"
                          : `Faltam ${formatMoney(progress.remainingCents)}`}
                      </span>
                    </div>
                    <div className="goals-plan">
                      <p>
                        <CalendarDays size={16} aria-hidden="true" />
                        {goal.targetDate
                          ? `Até ${dateLabel(goal.targetDate)}`
                          : "No seu tempo, sem prazo definido"}
                      </p>
                      {!goal.archived &&
                        !progress.achieved &&
                        progress.monthlyCents !== null && (
                          <p
                            className={progress.overdue ? "goals-overdue" : ""}
                          >
                            {progress.overdue ? (
                              "Prazo encerrado. Revise a data para planejar os próximos aportes."
                            ) : (
                              <>
                                Para chegar lá:{" "}
                                <strong>
                                  {formatMoney(progress.monthlyCents)} / mês
                                </strong>
                              </>
                            )}
                          </p>
                        )}
                    </div>
                    {goal.canEdit && (
                      <div className="goals-card-actions">
                        <button
                          className="button primary"
                          disabled={waiting || goal.archived}
                          onClick={() => openMovement(goal, "deposit")}
                        >
                          <Plus size={17} aria-hidden="true" />
                          Aportar
                        </button>
                        <button
                          className="button secondary"
                          disabled={waiting || progress.reservedCents <= 0}
                          onClick={() => openMovement(goal, "withdrawal")}
                        >
                          Resgatar
                        </button>
                      </div>
                    )}
                    <button
                      className="goals-history-button"
                      onClick={() => {
                        setError("");
                        setDetailId(goal.id);
                      }}
                    >
                      <History size={16} aria-hidden="true" />
                      Ver histórico
                    </button>
                  </article>
                );
              })}
            </section>
          )}
          {archivedCount > 0 && !showArchived && (
            <p className="goals-footnote">
              <Archive size={16} aria-hidden="true" />
              As reservas das metas arquivadas continuam no total acima.
            </p>
          )}
        </>
      )}

      {editor !== false && (
        <FeatureDialog
          title={editor ? "Editar meta" : "Nova meta"}
          onClose={() => {
            if (!waiting) setEditor(false);
          }}
        >
          <GoalForm
            initial={editor}
            defaultScope={scope}
            hasCouple={!!data.couple}
            busy={waiting}
            onCancel={() => setEditor(false)}
            onSave={(input) =>
              run(
                () =>
                  onSave(
                    editor
                      ? {
                          name: input.name,
                          targetCents: input.targetCents,
                          targetDate: input.targetDate,
                        }
                      : input,
                    editor?.id,
                  ),
                editor
                  ? "Meta atualizada."
                  : "Meta criada. Agora você pode registrar seus aportes.",
                () => {
                  setScope(input.scope);
                  setEditor(false);
                },
              )
            }
          />
        </FeatureDialog>
      )}

      {movementGoal && movement && (
        <FeatureDialog
          title={
            movement.kind === "deposit"
              ? "Registrar aporte"
              : "Registrar resgate"
          }
          onClose={() => {
            if (!waiting) setMovement(null);
          }}
        >
          <MovementForm
            key={`${movementGoal.id}:${movement.kind}`}
            goal={movementGoal}
            kind={movement.kind}
            reservedCents={
              goalProgress(movementGoal, movements, today).reservedCents
            }
            busy={waiting}
            onCancel={() => setMovement(null)}
            onSave={(input) =>
              run(
                () => onMovement(movementGoal.id, input),
                movement.kind === "deposit"
                  ? "Aporte registrado na caixinha."
                  : "Resgate registrado na caixinha.",
                () => setMovement(null),
              )
            }
          />
        </FeatureDialog>
      )}

      {detail && (
        <FeatureDialog
          title="Histórico da caixinha"
          onClose={() => {
            if (!waiting) setDetailId(null);
          }}
        >
          <div className="goals-detail">
            <p className="goals-detail-name">{detail.name}</p>
            <div className="goals-detail-balance">
              <span>Reservado atualmente</span>
              <strong>
                {formatMoney(
                  goalProgress(detail, movements, today).reservedCents,
                )}
              </strong>
            </div>
            <p className="goals-detail-note">
              Aportes e resgates manuais. Para corrigir um valor, registre o
              movimento inverso e mantenha o histórico.
            </p>
            {movements.some((item) => item.goalId === detail.id) ? (
              <ol className="goals-history-list">
                {movements
                  .filter((item) => item.goalId === detail.id)
                  .sort(
                    (a, b) =>
                      b.date.localeCompare(a.date) ||
                      b.createdAt.localeCompare(a.createdAt) ||
                      b.id.localeCompare(a.id),
                  )
                  .map((item) => (
                    <li key={item.id}>
                      <span className={`goals-movement-icon ${item.kind}`}>
                        <PiggyBank size={18} aria-hidden="true" />
                      </span>
                      <div>
                        <div className="goals-history-top">
                          <strong>
                            {item.kind === "deposit" ? "Aporte" : "Resgate"}
                          </strong>
                          <b>
                            {item.kind === "deposit" ? "+" : "−"}{" "}
                            {formatMoney(item.amountCents)}
                          </b>
                        </div>
                        <p>
                          {dateLabel(item.date)} ·{" "}
                          {item.ownerId === data.user.id
                            ? "Você"
                            : item.ownerName}
                        </p>
                        {item.note && (
                          <p className="goals-movement-note">{item.note}</p>
                        )}
                      </div>
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="goals-history-empty">
                Nenhum movimento registrado. Seu primeiro aporte aparecerá aqui.
              </p>
            )}
            <ErrorNote error={error} />
            {detail.canEdit && (
              <div className="goals-detail-actions">
                <button
                  className="button secondary"
                  disabled={waiting}
                  onClick={() => {
                    void run(
                      () => onSave({ archived: !detail.archived }, detail.id),
                      detail.archived
                        ? "Meta reativada."
                        : "Meta arquivada. O histórico e a reserva foram mantidos.",
                      () => setDetailId(null),
                    ).catch((err) => setError(message(err)));
                  }}
                >
                  {detail.archived ? (
                    <RotateCcw size={17} aria-hidden="true" />
                  ) : (
                    <Archive size={17} aria-hidden="true" />
                  )}
                  {detail.archived ? "Reativar meta" : "Arquivar meta"}
                </button>
                {!movements.some((item) => item.goalId === detail.id) && (
                  <button
                    className="button danger"
                    disabled={waiting}
                    onClick={() => {
                      setDetailId(null);
                      setRemove(detail);
                    }}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                    Excluir meta
                  </button>
                )}
              </div>
            )}
          </div>
        </FeatureDialog>
      )}

      {remove && (
        <FeatureDialog
          title="Excluir meta?"
          onClose={() => {
            if (!waiting) setRemove(null);
          }}
        >
          <p className="goals-dialog-copy">
            A meta <strong>{remove.name}</strong> será excluída. Apenas metas
            sem movimentos podem ser excluídas; as demais podem ser arquivadas.
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
                  () => onDelete(remove.id),
                  "Meta excluída.",
                  () => setRemove(null),
                ).catch((err) => setError(message(err)));
              }}
            >
              {waiting && (
                <LoaderCircle size={17} className="spin" aria-hidden="true" />
              )}
              Excluir meta
            </button>
          </div>
        </FeatureDialog>
      )}
    </div>
  );
}

function GoalForm({
  initial,
  defaultScope,
  hasCouple,
  busy,
  onSave,
  onCancel,
}: {
  initial: SavingsGoal | null;
  defaultScope: PlanScope;
  hasCouple: boolean;
  busy: boolean;
  onSave: (input: GoalInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [scope, setScope] = useState<PlanScope>(initial?.scope ?? defaultScope);
  const [target, setTarget] = useState(
    initial ? (initial.targetCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const targetCents = centsFromInput(target);
    if (!name.trim()) {
      setError("Dê um nome ao seu objetivo.");
      return;
    }
    if (targetCents === null) {
      setError(
        "Informe um valor desejado maior que zero, com até duas casas decimais.",
      );
      return;
    }
    try {
      await onSave({
        scope,
        name: name.trim(),
        targetCents,
        targetDate: targetDate || null,
        archived: initial?.archived ?? false,
      });
    } catch (err) {
      setError(message(err));
    }
  }
  return (
    <form className="goals-form" onSubmit={submit}>
      <p className="goals-dialog-copy">
        Defina um objetivo e registre quanto já destinou a ele. Você pode
        ajustar o valor e o prazo depois.
      </p>
      <label className="field-label" htmlFor="goal-name">
        Nome da meta
      </label>
      <input
        id="goal-name"
        placeholder="Ex.: Reserva de emergência"
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        disabled={busy}
      />
      <label className="field-label" htmlFor="goal-scope">
        Visibilidade
      </label>
      <div className="select-wrap">
        <select
          id="goal-scope"
          value={scope}
          disabled={!!initial || busy}
          onChange={(event) => setScope(event.target.value as PlanScope)}
        >
          <option value="personal">Pessoal</option>
          <option value="couple" disabled={!hasCouple}>
            Do casal
          </option>
        </select>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
      <p className="goals-field-help">
        {scope === "couple"
          ? "O nome, os valores, as observações e os movimentos serão visíveis para os dois. Ambos podem editar."
          : "Esta meta e seus movimentos ficam visíveis somente para você."}
      </p>
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="goal-target">
            Valor desejado (R$)
          </label>
          <input
            id="goal-target"
            inputMode="decimal"
            placeholder="Ex.: 5.000,00"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            required
            disabled={busy}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="goal-deadline">
            Prazo (opcional)
          </label>
          <input
            id="goal-deadline"
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <p className="goals-field-help">
        Com um prazo, mostramos quanto falta reservar por mês, sem considerar
        rendimentos. Sem prazo, você acompanha o progresso no seu ritmo.
      </p>
      <ErrorNote error={error} />
      <div className="modal-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancelar
        </button>
        <button type="submit" className="button primary" disabled={busy}>
          {busy && (
            <LoaderCircle size={17} className="spin" aria-hidden="true" />
          )}
          {initial ? "Salvar alterações" : "Criar meta"}
        </button>
      </div>
    </form>
  );
}

function MovementForm({
  goal,
  kind,
  reservedCents,
  busy,
  onSave,
  onCancel,
}: {
  goal: SavingsGoal;
  kind: GoalMovementInput["kind"];
  reservedCents: number;
  busy: boolean;
  onSave: (input: GoalMovementInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const submitted = useRef<{ payload: string; id: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const amountCents = centsFromInput(amount);
    if (amountCents === null) {
      setError("Informe um valor maior que zero, com até duas casas decimais.");
      return;
    }
    if (kind === "withdrawal" && amountCents > reservedCents) {
      setError(
        "O resgate não pode ultrapassar o valor reservado nesta caixinha.",
      );
      return;
    }
    if (kind === "deposit" && goal.archived) {
      setError("Reative a meta antes de registrar novos aportes.");
      return;
    }
    if (date > todayISO()) {
      setError("Registre apenas movimentos realizados até hoje.");
      return;
    }
    const values = { kind, amountCents, date, note: note.trim() };
    const payload = JSON.stringify(values);
    if (!submitted.current || submitted.current.payload !== payload)
      submitted.current = { payload, id: crypto.randomUUID() };
    try {
      await onSave({ ...values, id: submitted.current.id });
    } catch (err) {
      setError(message(err));
    }
  }
  return (
    <form className="goals-form" onSubmit={submit}>
      <p className="goals-detail-name">{goal.name}</p>
      <div className="goals-detail-balance">
        <span>Reservado atualmente</span>
        <strong>{formatMoney(reservedCents)}</strong>
      </div>
      <p className="goals-dialog-copy">
        {kind === "deposit"
          ? "Informe um valor que você já separou para esta meta. O registro não movimenta dinheiro entre suas contas."
          : "Informe quanto deixou de reservar para esta meta. O resgate não cria uma receita no seu histórico financeiro."}
      </p>
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="goal-movement-amount">
            Valor do {kind === "deposit" ? "aporte" : "resgate"} (R$)
          </label>
          <input
            id="goal-movement-amount"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            disabled={busy}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="goal-movement-date">
            Data do movimento
          </label>
          <input
            id="goal-movement-date"
            type="date"
            max={todayISO()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
            disabled={busy}
          />
        </div>
      </div>
      <label className="field-label" htmlFor="goal-movement-note">
        Observação (opcional)
      </label>
      <textarea
        id="goal-movement-note"
        placeholder="Ex.: Parte do valor reservado neste mês"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={250}
        rows={3}
        disabled={busy}
      />
      {goal.scope === "couple" && (
        <p className="goals-field-help">
          O casal verá este movimento, a observação e quem o registrou.
        </p>
      )}
      <ErrorNote error={error} />
      <div className="modal-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancelar
        </button>
        <button type="submit" className="button primary" disabled={busy}>
          {busy && (
            <LoaderCircle size={17} className="spin" aria-hidden="true" />
          )}
          {kind === "deposit" ? "Confirmar aporte" : "Confirmar resgate"}
        </button>
      </div>
    </form>
  );
}

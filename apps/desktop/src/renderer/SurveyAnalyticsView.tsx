import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Field, Select, Spinner } from "@fluentui/react-components";
import { ArrowUpload24Regular, Document24Regular, Folder24Regular } from "@fluentui/react-icons";
import { Input } from "./WorkspaceInput";
import { WorkspaceSelect } from "./WorkspaceSelect";
import type { SurveyAnalysis, SurveyAnalysisDetail, SurveyConfiguration, SurveyFilter, SurveyQuestionType } from "@yuksalish/contracts";
import { downloadSurveyOriginal, exportSurveyWorkbook, importSurveyAnalysis, listSurveyAnalyses, loadSurveyAnalysis, saveSurveyAnalysis } from "./workspace-api";
import { buildSurveyDataset, filterSurveyRows, surveyComparison, surveyCsv, surveyDistribution, surveyNumericSummary, surveyQuality } from "./survey-engine";
import type { SurveyQuestion, SurveyRow } from "./survey-engine";
import "./survey-analytics.css";

const typeLabels: Readonly<Record<SurveyQuestionType, string>> = {
  categorical: "Один вариант", multiple: "Множественный выбор", numeric: "Число",
  text: "Текст", excluded: "Исключено из сводок",
};
const filterLabels = { equals: "равно", contains: "содержит", range: "диапазон", empty: "пропуск", filled: "заполнено" } as const;
const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить действие.";
const number = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const fileSize = (bytes: number) => bytes < 1024 ? `${number(bytes)} Б` : bytes < 1024 * 1024 ? `${number(bytes / 1024)} КиБ` : `${number(bytes / 1024 / 1024)} МиБ`;
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type Tab = "questions" | "comparison" | "quality" | "data";

function Distribution({ rows, question, configuration }: { readonly rows: readonly SurveyRow[]; readonly question: SurveyQuestion; readonly configuration: SurveyConfiguration }) {
  const summary = useMemo(() => surveyDistribution(rows, question, configuration), [rows, question, configuration]);
  const [limit, setLimit] = useState(20);
  return <div>
    <p>Ответили: <strong>{summary.answered}</strong> из {rows.length} · Пропуски: {summary.missing}.</p>
    {question.type === "multiple" && <p className="survey-note">Каждый вариант считается не более одного раза на строку. Знаменатель — ответившие на вопрос; сумма процентов может быть больше 100%.</p>}
    {summary.entries.length === 0 ? <p>Нет ответов в выбранном срезе.</p> : <div className="survey-bars">
      {summary.entries.slice(0, limit).map((entry) => <div className="survey-bar" key={entry.key}>
        <span>{entry.label}</span><span>{entry.count} / {summary.answered} · {number(entry.percentage)}%</span>
        <progress aria-label={`${entry.label}: ${entry.count} из ${summary.answered}`} value={entry.percentage} max={100} />
      </div>)}
    </div>}
    {summary.entries.length > limit && <Button onClick={() => setLimit(limit + 20)}>Ещё варианты ({summary.entries.length - limit})</Button>}
  </div>;
}

export function SurveyAnalyticsView({ token, canCreate, canEdit }: { readonly token: string; readonly canCreate: boolean; readonly canEdit: boolean }) {
  const [analyses, setAnalyses] = useState<readonly SurveyAnalysis[]>([]);
  const [detail, setDetail] = useState<SurveyAnalysisDetail>();
  const [configuration, setConfiguration] = useState<SurveyConfiguration>();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File>();
  const [dragging, setDragging] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [encoding, setEncoding] = useState("utf-8-sig");
  const [delimiter, setDelimiter] = useState(",");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [archive, setArchive] = useState(false);
  const [tab, setTab] = useState<Tab>("questions");
  const [column, setColumn] = useState(0);
  const [groupColumn, setGroupColumn] = useState(0);
  const [page, setPage] = useState(0);
  const [columnPage, setColumnPage] = useState(0);
  const [filterColumn, setFilterColumn] = useState(0);
  const [filterOperator, setFilterOperator] = useState<NonNullable<SurveyFilter["operator"]>>("equals");
  const [filterValue, setFilterValue] = useState("");
  const [filterUpper, setFilterUpper] = useState("");
  const [viewName, setViewName] = useState("");
  const [missingText, setMissingText] = useState("");
  const visibleAnalyses = analyses.filter((item) => item.archived === archive && item.title.toLocaleLowerCase().includes(listQuery.toLocaleLowerCase()));
  const dirty = !!detail && !!configuration && (title !== detail.analysis.title || JSON.stringify(configuration) !== JSON.stringify(detail.analysis.configuration));
  const uploadDisabled = busy || !canCreate || dirty;
  const chooseFile = (next: File | undefined) => {
    if (uploadDisabled || !next) return;
    setFile(undefined); setError("");
    if (!/\.(csv|xlsx|xls)$/i.test(next.name)) { setError("Выберите файл CSV, XLSX или XLS."); return; }
    if (next.size > 10 * 1024 * 1024) { setError("Размер файла не должен превышать 10 МиБ."); return; }
    setFile(next); setRequestId(crypto.randomUUID());
  };
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setAnalyses(await listSurveyAnalyses(token)); }
    catch (failure) { setError(message(failure)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => {
    let active = true;
    void listSurveyAnalyses(token).then((items) => { if (active) setAnalyses(items); })
      .catch((failure: unknown) => { if (active) setError(message(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);
  const dataset = useMemo(() => detail && configuration ? buildSurveyDataset(detail.workbook, configuration) : undefined, [detail, configuration]);
  const rows = useMemo(() => dataset && configuration ? filterSurveyRows(dataset, configuration) : [], [dataset, configuration]);
  const questions = useMemo(() => dataset?.questions.filter((item) => item.type !== "excluded") ?? [], [dataset]);
  const question = questions.find((item) => item.column === column) ?? questions[0];
  const quality = useMemo(() => dataset && configuration ? surveyQuality(dataset, configuration, rows) : undefined, [dataset, configuration, rows]);
  const comparison = useMemo(() => {
    const chosen = dataset?.questions.find((item) => item.column === column && item.type !== "excluded")
      ?? dataset?.questions.find((item) => item.type !== "excluded");
    const grouped = dataset?.questions.find((item) => item.column === groupColumn && item.type !== "excluded");
    return chosen && grouped && chosen.column !== grouped.column && configuration ? surveyComparison(rows, chosen, grouped, configuration) : undefined;
  }, [rows, dataset, column, groupColumn, configuration]);
  const numeric = question && configuration && question.type === "numeric" ? surveyNumericSummary(rows, question, configuration) : undefined;
  const patch = (changes: Partial<SurveyConfiguration>) => {
    if (configuration) setConfiguration({ ...configuration, ...changes });
    setPage(0); setNotice("");
  };
  const accept = (value: SurveyAnalysisDetail) => {
    setDetail(value); setConfiguration(value.analysis.configuration); setTitle(value.analysis.title);
    setMissingText(value.analysis.configuration.missingValues.join(";"));
    setColumn(0); setGroupColumn(0); setPage(0); setColumnPage(0); setTab("questions");
    setFilterColumn(0); setFilterValue(""); setFilterUpper(""); setViewName("");
    setAnalyses((previous) => [value.analysis, ...previous.filter((item) => item.id !== value.analysis.id)]);
  };
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  };
  const save = async (archived = detail?.analysis.archived ?? false) => {
    if (!detail || !configuration) return;
    const result = await saveSurveyAnalysis(token, detail.analysis.id, {
      expectedRevision: detail.analysis.revision, title: title.trim(), archived, configuration,
    });
    accept({ analysis: result, workbook: detail.workbook });
    setNotice("Анализ сохранён приватно. Его можно открыть позже.");
  };
  const addFilter = () => {
    if (!configuration || configuration.filters.length >= 20) return;
    if (filterOperator === "range") {
      const from = Number(filterValue.replace(",", "."));
      const to = Number(filterUpper.replace(",", "."));
      if (!filterValue.trim() || !filterUpper.trim() || !Number.isFinite(from) || !Number.isFinite(to) || from > to) {
        setError("Укажите числовой диапазон: начало не больше конца."); return;
      }
    } else if (!["empty", "filled"].includes(filterOperator) && !filterValue.trim()) { setError("Введите значение фильтра."); return; }
    patch({ filters: [...configuration.filters, { column: filterColumn, operator: filterOperator, value: filterValue, upper: filterUpper }] });
    setError(""); setFilterValue(""); setFilterUpper("");
  };
  const exportRows = () => {
    if (!dataset || !configuration || !detail) return;
    const metadata = [
      ["Анализ", title], ["Файл", detail.analysis.fileName], ["Лист", dataset.sheetName],
      ["Строка заголовков", String(configuration.headerRow + 1)],
      ["Все непустые строки", String(dataset.rows.length)], ["Строки среза", String(rows.length)],
      ["Поиск", configuration.query], ["Фильтры", JSON.stringify(configuration.filters)],
      ["Типы столбцов", JSON.stringify(dataset.questions.map((item) => [item.column + 1, item.label, item.type]))],
      ["Пропуски", JSON.stringify(configuration.missingValues)], ["Разделитель множественного выбора", configuration.separator],
      ["Методика", "Одна строка = один предполагаемый респондент. Невзвешенные описательные результаты; не доказательство репрезентативности. Проценты от ответивших на вопрос; в множественном выборе варианты не суммируются в 100%."],
      ["Экспорт", "Потенциальные формулы в CSV нейтрализованы; исходный файл не изменён."],
      [], ["Строка исходного файла", ...dataset.questions.map((item) => item.label)],
      ...rows.map((row) => [String(row.sourceRow), ...dataset.questions.map((item) => row.values[item.column] ?? "")]),
    ];
    download(new Blob([surveyCsv(metadata)], { type: "text/csv;charset=utf-8" }), "survey-answers.csv");
  };
  const exportSummary = () => {
    if (!question || !configuration) return;
    const summary = surveyDistribution(rows, question, configuration);
    const output = [["Вопрос", question.label], ["Тип", typeLabels[question.type]], ["Строк в срезе", String(rows.length)],
      ["Ответившие (знаменатель)", String(summary.answered)], ["Пропуски", String(summary.missing)],
      ["Методика", "Без весов и проверки репрезентативности. В множественном выборе каждый вариант один раз на строку; сумма процентов может быть больше 100%."],
      ["Вариант", "Строк", "% от ответивших"], ...summary.entries.map((entry) => [entry.label, String(entry.count), String(entry.percentage)])];
    if (numeric) output.push(["Корректных чисел", String(numeric.count)], ["Нечисловых ответов", String(numeric.invalid)], ["Среднее", String(numeric.mean ?? "")], ["Медиана", String(numeric.median ?? "")]);
    download(new Blob([surveyCsv(output)], { type: "text/csv;charset=utf-8" }), "survey-summary.csv");
  };
  return <section className="workspace-view survey-analytics" aria-busy={busy || loading}>
    <header className="survey-heading"><div><span className="survey-eyebrow">ЛИЧНОЕ РАБОЧЕЕ ПРОСТРАНСТВО</span><h1>Аналитика опросов</h1>
      <p>Исходные ответы и сохранённые анализы доступны только вам. Без отправки в ИИ.</p></div>
      <Button disabled={busy} onClick={() => void refresh()}>Обновить список</Button></header>
    {error && <div className="survey-error" role="alert">{error} <Button disabled={busy} onClick={() => void refresh()}>Повторить загрузку списка</Button></div>}
    {notice && <p role="status" className="survey-note">{notice}</p>}
    <div className="survey-layout">
      <aside className="survey-panel survey-library" aria-label="Мои анализы">
        <div className="survey-panel-heading"><div><span className="survey-section-label">Библиотека</span><h2>Мои анализы</h2></div><Folder24Regular aria-hidden="true" /></div>
        <div className="survey-library-search-row"><Field label="Поиск анализов"><Input className="survey-library-search" aria-label="Поиск анализов" placeholder="Название анализа" value={listQuery} onChange={(_, data) => setListQuery(data.value)} /></Field></div>
        <label className="survey-check"><input type="checkbox" checked={archive} onChange={(event) => setArchive(event.target.checked)} />Показать архив</label>
        {loading ? <Spinner label="Загрузка личных анализов" /> : <div className="survey-analysis-list">
          {visibleAnalyses.map((item) => <Button key={item.id}
            className="survey-analysis-item" aria-pressed={detail?.analysis.id === item.id} disabled={busy || dirty}
            onClick={() => void perform(async () => accept(await loadSurveyAnalysis(token, item.id)))}>
            <span>{item.title}<small>{new Date(item.updatedAt).toLocaleDateString("ru-RU")} · версия {item.revision}</small></span>
          </Button>)}
          {!visibleAnalyses.length && <div className="survey-library-empty"><Document24Regular aria-hidden="true" /><h3>{listQuery ? "Ничего не найдено" : archive ? "Архив пуст" : "Пока нет анализов"}</h3><p>{listQuery ? "Попробуйте другое название." : archive ? "Здесь будут архивные анализы." : "Загрузите первый опрос. Сохранённые анализы появятся здесь."}</p></div>}
        </div>}
        <p className="survey-library-footer">Личная библиотека · без отправки в ИИ</p>
      </aside>
      <div className="survey-workspace">
        <section className="survey-panel survey-import" aria-label="Загрузка опроса">
          <div className="survey-panel-heading"><div><span className="survey-section-label">Новый анализ</span><h2>Загрузить опрос</h2><p>Начните с выгрузки ответов из вашего сервиса опросов.</p></div><ArrowUpload24Regular aria-hidden="true" /></div>
          <label className="survey-file-drop" data-dragging={dragging} data-disabled={uploadDisabled}
            onDragOver={(event) => { event.preventDefault(); if (!uploadDisabled) setDragging(true); }}
            onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
            <input aria-label="Файл опроса" type="file" accept=".csv,.xlsx,.xls" disabled={uploadDisabled}
              onChange={(event) => chooseFile(event.target.files?.[0])} />
            <span className="survey-file-icon">{file ? <Document24Regular aria-hidden="true" /> : <ArrowUpload24Regular aria-hidden="true" />}</span>
            <strong>{file ? file.name : "Выберите файл или перетащите его сюда"}</strong>
            <span>{file ? `${fileSize(file.size)} · нажмите, чтобы заменить` : "CSV, XLSX или XLS · до 10 МиБ"}</span>
            <span className="survey-file-action">{file ? "Заменить файл" : "Выбрать файл"}</span>
          </label>
          <div className="survey-import-options">
          <Field label="Кодировка CSV"><WorkspaceSelect aria-label="Кодировка CSV" value={encoding} disabled={busy || dirty} onChange={event => { setEncoding(event.target.value); setRequestId(crypto.randomUUID()); }}><option value="utf-8-sig">UTF-8</option><option value="cp1251">Windows-1251</option></WorkspaceSelect></Field>
          <Field label="Разделитель столбцов CSV"><WorkspaceSelect aria-label="Разделитель столбцов CSV" value={delimiter} disabled={busy || dirty} onChange={event => { setDelimiter(event.target.value); setRequestId(crypto.randomUUID()); }}><option value=",">Запятая</option><option value=";">Точка с запятой</option><option value="\t">Табуляция</option></WorkspaceSelect></Field>
          </div>
          <div className="survey-import-footer"><p>До 25 000 строк на лист · 150 000 ячеек на файл</p><Button appearance="primary" disabled={!file || uploadDisabled} onClick={() => void perform(async () => {
            if (file) { accept(await importSurveyAnalysis(token, file, requestId, encoding, delimiter)); setNotice("Файл сохранён приватно. Проверьте лист, заголовки и типы вопросов перед выводами."); }
          })}>{busy ? "Загрузка…" : "Загрузить и открыть"}</Button></div>
          {!canCreate && <p>У вас нет права создавать анализы.</p>}
          {dirty && <p className="survey-note">Сохраните или отмените изменения текущего анализа перед загрузкой нового файла.</p>}
        </section>
      <div role="region" aria-label="Анализ опроса" className="survey-panel survey-workbench">
        <fieldset aria-label="Настройки и результаты анализа" disabled={busy} className="survey-interaction">
        {!detail || !configuration || !dataset ? <div className="survey-empty"><span className="survey-section-label">Рабочая область</span><h2>От ответов — к понятным результатам</h2>
          <p>Загрузите опрос или откройте сохранённый анализ из библиотеки.</p>
          <ol className="survey-start-steps"><li><span>01</span><div><h3>Проверьте структуру</h3><p>Выберите лист, заголовки и типы вопросов.</p></div></li><li><span>02</span><div><h3>Изучите ответы</h3><p>Распределения, сравнение групп и качество данных.</p></div></li><li><span>03</span><div><h3>Сохраните результат</h3><p>Настройки, срезы и экспорт для дальнейшей работы.</p></div></li></ol>
          <p className="survey-methodology">Одна строка — один предполагаемый респондент. Расчёты описывают ответы в файле, не доказывают репрезентативность и не объясняют причины.</p></div> : <>
          <div className="survey-actions"><Field label="Название анализа"><Input value={title} maxLength={240} disabled={busy || !canEdit} onChange={(_, data) => { setTitle(data.value); setNotice(""); }} /></Field>
            <Button appearance="primary" disabled={busy || !canEdit || !dirty || !title.trim()} onClick={() => void perform(() => save())}>Сохранить изменения</Button>
            <Button disabled={busy || !dirty} onClick={() => { accept(detail); setNotice("Несохранённые настройки отменены."); }}>Отменить изменения</Button>
            <Button disabled={busy} onClick={() => void perform(async () => download(await downloadSurveyOriginal(token, detail.analysis.id), detail.analysis.fileName))}>Исходный файл</Button>
            <Button disabled={busy || !canEdit || dirty} onClick={() => void perform(() => save(!detail.analysis.archived))}>{detail.analysis.archived ? "Вернуть из архива" : "В архив"}</Button></div>
          {dirty && <p role="status" className="survey-note">Настройки изменены локально. Они сохраняются при переключении разделов, но не после выхода из учётной записи или перезагрузки. Нажмите «Сохранить изменения».</p>}
          {detail.workbook.warnings.map((warning) => <p className="survey-note" key={warning}>{warning}</p>)}
          <details open className="survey-settings"><summary>1. Проверить структуру и интерпретацию</summary><div className="survey-controls">
            <Field label="Лист книги"><Select value={String(configuration.sheet)} disabled={busy} onChange={(_, data) => { patch({ sheet: Number(data.value), headerRow: 0, types: {}, filters: [], savedViews: [] }); setColumnPage(0); setColumn(0); setGroupColumn(0); setFilterColumn(0); }}>
              {detail.workbook.sheets.map((sheet, index) => <option key={sheet.name} value={index}>{sheet.name} · {sheet.rows.length} строк</option>)}</Select></Field>
            <Field label="Строка заголовков (в исходном файле)"><Input type="number" min={1} max={detail.workbook.sheets[configuration.sheet]?.rows.length ?? 1} value={String(configuration.headerRow + 1)} onChange={(_, data) => {
              const next = Number(data.value); const count = detail.workbook.sheets[configuration.sheet]?.rows.length ?? 0;
              if (Number.isInteger(next) && next >= 1 && next <= count) {
                patch({ headerRow: next - 1, types: {}, filters: [], savedViews: [] });
                setColumnPage(0); setColumn(0); setGroupColumn(0); setFilterColumn(0);
              }
            }} /></Field>
            <Field label="Разделитель множественного выбора"><Select value={configuration.separator} onChange={(_, data) => patch({ separator: data.value as SurveyConfiguration["separator"] })}><option value=";">Точка с запятой</option><option value="|">Вертикальная черта</option><option value=",">Запятая</option></Select></Field>
            <Field label="Дополнительные пропуски (через ;)"><Input value={missingText} maxLength={2000} onChange={(_, data) => { setMissingText(data.value); patch({ missingValues: data.value.split(";").filter((value) => value.trim()) }); }} /></Field>
          </div><p>Один столбец — один вопрос. Листы и отдельные checkbox-столбцы не объединяются автоматически. До заголовка строки исключены; полностью пустых строк после него: {dataset.blankRows}. «null», «нет» и 0 не считаются пропусками без вашего указания.</p>
            <div className="survey-table-scroll"><table><caption>Превью: заголовки и первые 3 строки, первые 12 столбцов</caption><thead><tr><th>Строка</th>{dataset.questions.slice(0, 12).map((item) => <th key={item.column}>{item.label}</th>)}</tr></thead><tbody>{dataset.rows.slice(0, 3).map((row) => <tr key={row.sourceRow}><th>{row.sourceRow}</th>{dataset.questions.slice(0, 12).map((item) => <td key={item.column}>{row.values[item.column] ?? ""}</td>)}</tr>)}</tbody></table></div>
          </details>
          <div className="survey-metrics"><div><strong>{dataset.rows.length}</strong><span>непустых строк на листе</span></div><div><strong>{rows.length}</strong><span>строк в текущем срезе</span></div><div><strong>{questions.length}</strong><span>вопросов в сводках</span></div><div><strong>{quality?.flaggedRows ?? 0}</strong><span>строк с флагами проверки</span></div></div>
          <details className="survey-settings"><summary>2. Поиск, фильтры и сохранённые срезы</summary><Field label="Поиск по всем ответам"><Input aria-label="Поиск по всем ответам" value={configuration.query} maxLength={200} onChange={(_, data) => patch({ query: data.value })} /></Field>
            <div className="survey-controls"><Field label="Столбец фильтра"><Select value={filterColumn} onChange={(_, data) => setFilterColumn(Number(data.value))}>{dataset.questions.map((item) => <option value={item.column} key={item.column}>{item.label}</option>)}</Select></Field>
              <Field label="Условие"><Select value={filterOperator} onChange={(_, data) => setFilterOperator(data.value as NonNullable<SurveyFilter["operator"]>)}><option value="equals">Равно варианту</option><option value="contains">Содержит текст</option><option value="range">Числовой диапазон</option><option value="empty">Пропуск</option><option value="filled">Заполнено</option></Select></Field>
              {!["empty", "filled"].includes(filterOperator) && <Field label={filterOperator === "range" ? "От" : "Значение"}><Input value={filterValue} maxLength={2000} onChange={(_, data) => setFilterValue(data.value)} /></Field>}
              {filterOperator === "range" && <Field label="До включительно"><Input value={filterUpper} maxLength={2000} onChange={(_, data) => setFilterUpper(data.value)} /></Field>}
              <Button disabled={configuration.filters.length >= 20} onClick={addFilter}>Добавить фильтр</Button>
            </div><p>Все фильтры применяются вместе (И). В множественном выборе «Равно» ищет отдельный вариант.</p>
            {configuration.filters.map((filter, index) => <div className="survey-filter-chip" key={index}><span>{dataset.questions[filter.column]?.label} · {filterLabels[filter.operator ?? "equals"]} · {filter.value}{filter.upper ? ` — ${filter.upper}` : ""}</span><Button aria-label={`Убрать фильтр ${index + 1}`} onClick={() => patch({ filters: configuration.filters.filter((_, item) => item !== index) })}>Убрать</Button></div>)}
            <div className="survey-actions"><Button onClick={() => patch({ query: "", filters: [] })}>Сбросить срез</Button><Field label="Название сохранённого среза"><Input value={viewName} maxLength={100} onChange={(_, data) => setViewName(data.value)} /></Field>
              <Button disabled={!viewName.trim() || configuration.savedViews.length >= 20} onClick={() => { patch({ savedViews: [...configuration.savedViews, { name: viewName.trim(), query: configuration.query, filters: configuration.filters }] }); setViewName(""); }}>Добавить срез к настройкам</Button></div>
            {configuration.savedViews.map((view, index) => <div className="survey-filter-chip" key={index}><Button onClick={() => patch({ query: view.query, filters: view.filters })}>{view.name}</Button><Button aria-label={`Удалить срез ${view.name}`} onClick={() => patch({ savedViews: configuration.savedViews.filter((_, item) => item !== index) })}>Убрать</Button></div>)}
          </details>
          <div className="survey-tabs" role="group" aria-label="Разделы анализа">{([["questions", "Вопросы"], ["comparison", "Сравнение групп"], ["quality", "Качество данных"], ["data", "Ответы"]] as const).map(([key, label]) => <Button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</Button>)}<Button onClick={exportRows}>Экспорт среза CSV</Button>
            <Button disabled={busy} onClick={() => void perform(async () => download(await exportSurveyWorkbook(token, detail.analysis.id, { configuration, rowNumbers: rows.map((row) => row.sourceRow) }), "survey-export.xlsx"))}>Экспорт среза Excel</Button></div>
          {(tab === "questions" || tab === "comparison") && <div className="survey-controls"><Field label="Вопрос"><Select value={question?.column ?? ""} onChange={(_, data) => setColumn(Number(data.value))}>{questions.map((item) => <option value={item.column} key={item.column}>{item.label}</option>)}</Select></Field>
            {question && <Field label="Тип выбранного вопроса"><Select value={question.type} onChange={(_, data) => patch({ types: { ...configuration.types, [question.column]: data.value as SurveyQuestionType } })}>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>}
          </div>}
          {tab === "questions" && (question ? <div><h2>{question.label}</h2><p className="survey-note">{configuration.types[String(question.column)] ? "Тип задан вами." : `Автоопределение — подсказка, не подтверждение: ${question.reason}`}</p>
            {numeric && <div className="survey-metrics">{([["Корректных чисел", numeric.count], ["Среднее", numeric.mean], ["Медиана", numeric.median], ["Минимум", numeric.min], ["Максимум", numeric.max], ["Нечисловых ответов", numeric.invalid]] as const).map(([label, value]) => <div key={label}><strong>{number(value)}</strong><span>{label}</span></div>)}</div>}
            <Distribution key={`${question.column}-${question.type}`} rows={rows} question={question} configuration={configuration} /><Button onClick={exportSummary}>Экспорт сводки CSV</Button></div> : <p>Нет вопросов в сводках. В разделе качества можно изменить тип исключённого столбца.</p>)}
          {tab === "comparison" && <><Field label="Разбить по вопросу"><Select value={groupColumn} onChange={(_, data) => setGroupColumn(Number(data.value))}>{questions.map((item) => <option key={item.column} value={item.column}>{item.label}</option>)}</Select></Field>
            {question?.column === groupColumn && <p className="survey-note">Выберите другой вопрос для группировки: сравнивать вопрос с самим собой неинформативно.</p>}
            <p>Сравнение описательное: без статистической значимости и причинных выводов. Без группы: {comparison?.ungrouped ?? rows.length}. {comparison?.overlapping ? "Группы пересекаются: одна строка может входить в несколько групп." : "Процент считается внутри каждой группы от ответивших на выбранный вопрос."}</p>
            <div className="survey-group-grid">{comparison?.groups.slice(0, 20).map((item) => <article key={item.label}><h3>{item.label}</h3><p>Строк в группе: {item.size} · ответили: {item.distribution.answered} · пропуски: {item.distribution.missing}</p>{item.numeric && <p>Среднее: {number(item.numeric.mean)} · медиана: {number(item.numeric.median)} · корректных чисел: {item.numeric.count}</p>}<ul>{item.distribution.entries.slice(0, 10).map((entry) => <li key={entry.key}>{entry.label}: {entry.count} / {item.distribution.answered} ({number(entry.percentage)}%)</li>)}</ul>{item.distribution.entries.length > 10 && <p>Показаны первые 10 вариантов из {item.distribution.entries.length}. Полная сводка — во вкладке «Вопросы» с фильтром группы.</p>}</article>)}</div>
            {(comparison?.groups.length ?? 0) > 20 && <p>Показаны первые 20 групп. Выберите нужные группы фильтром.</p>}</>}
          {tab === "quality" && <><h2>Что проверить перед выводами</h2><p>Полностью совпадающие строки: {quality?.repeatedRows.length ?? 0} повторов. Это флаг, а не доказательство повторного участия; строки не удаляются. Пропуск сам по себе не означает ошибку.</p>
            <p>Тип «Исключено» убирает столбец из сводок, но не анонимизирует исходный файл или экспорт ответов.</p>
            <div className="survey-table-scroll"><table><thead><tr><th>Столбец</th><th>Тип</th><th>Пропуски в срезе</th><th>Нечисловые</th></tr></thead><tbody>{dataset.questions.map((item) => {
              const stat = quality?.questions.find((entry) => entry.question.column === item.column);
              return <tr key={item.column}><th>{item.label}</th><td><Select aria-label={`Тип: ${item.label}`} value={item.type} onChange={(_, data) => patch({ types: { ...configuration.types, [item.column]: data.value as SurveyQuestionType } })}>{Object.entries(typeLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</Select></td><td>{stat ? `${stat.missing} / ${rows.length}` : "Исключено"}</td><td>{stat?.invalid ?? "—"}</td></tr>;
            })}</tbody></table></div></>}
          {tab === "data" && <><p>Ответы без изменения исходных значений. Экспорт включает все столбцы, включая личные данные: перед передачей проверьте файл.</p>
            <div className="survey-actions"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>Предыдущие строки</Button><span>{rows.length ? page * 50 + 1 : 0}–{Math.min((page + 1) * 50, rows.length)} из {rows.length}</span><Button disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>Следующие строки</Button>
              <Button disabled={columnPage === 0} onClick={() => setColumnPage(columnPage - 1)}>Предыдущие столбцы</Button><Button disabled={(columnPage + 1) * 12 >= dataset.questions.length} onClick={() => setColumnPage(columnPage + 1)}>Следующие столбцы</Button></div>
            <div className="survey-table-scroll"><table><caption>Столбцы {columnPage * 12 + 1}–{Math.min((columnPage + 1) * 12, dataset.questions.length)} из {dataset.questions.length}</caption><thead><tr><th>Строка файла</th>{dataset.questions.slice(columnPage * 12, (columnPage + 1) * 12).map((item) => <th key={item.column}>{item.label}</th>)}</tr></thead><tbody>{rows.slice(page * 50, (page + 1) * 50).map((row) => <tr key={row.sourceRow}><th>{row.sourceRow}</th>{dataset.questions.slice(columnPage * 12, (columnPage + 1) * 12).map((item) => <td key={item.column}>{row.values[item.column] ?? ""}</td>)}</tr>)}</tbody></table></div></>}
          <footer className="survey-methodology">3. Интерпретация: расчёты невзвешенные. Пропуски исключены из знаменателя вопроса; для числовых сводок также исключены нечисловые значения. Результаты описывают загруженные строки, а не всё население. Автотипы проверяются вручную; выборка, веса и качество сбора — ответственность исследователя.</footer>
        </>}
        </fieldset>
      </div>
      </div>
    </div>
  </section>;
}

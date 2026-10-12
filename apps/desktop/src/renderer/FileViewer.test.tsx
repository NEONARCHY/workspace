import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OfficeFilePreview, WorkspaceAttachment } from "@yuksalish/contracts";
import FileViewer, { LocalFileViewer } from "./FileViewer";
import { AttachmentChips } from "./AttachmentPanel";
import { fileViewerKind } from "./file-viewer-kind";
import { workspaceTheme } from "./workspace-theme";

const file: WorkspaceAttachment = {id:"file-1",ownerType:"task",ownerId:"task-1",fileName:"Документ.docx",contentType:"application/octet-stream",byteSize:1200,sha256:"test",uploadedByUserId:"user-1",documentRole:"general",createdAt:"2026-10-12T10:00:00Z"};
const word: OfficeFilePreview = {kind:"word",blocks:[{kind:"paragraph",text:"<script>не исполнять</script>",rows:[]},{kind:"table",text:"",rows:[["Отдел","План"],["ЦА","42"]]}],sheets:[],sheetIndex:0,rowOffset:0,totalRows:0,rows:[],truncated:false};
const excel: OfficeFilePreview = {...word,kind:"excel",blocks:[],sheets:["План","Итоги"],totalRows:420,rows:[["Мероприятие","Срок"],["Встреча","13 октября"]]};
const wrap = (node: React.ReactNode) => <FluentProvider theme={workspaceTheme}>{node}</FluentProvider>;
function props(attachment = file) { return {attachment,onClose:vi.fn(),onLoad:vi.fn().mockResolvedValue(new Blob(["file"])),onLoadOffice:vi.fn().mockResolvedValue(word),onDownload:vi.fn()}; }
beforeEach(() => { vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:preview"); vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{}); vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(()=>{}); vi.spyOn(HTMLMediaElement.prototype,"load").mockImplementation(()=>{}); });
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it("classifies documents and media, giving video MIME precedence over webm audio fallback",()=>{
  expect(fileViewerKind(file)).toBe("word");
  expect(fileViewerKind({...file,fileName:"sheet.xlsx"})).toBe("excel");
  expect(fileViewerKind({...file,fileName:"clip.webm",contentType:"video/webm"})).toBe("video");
  expect(fileViewerKind({...file,fileName:"song.mp3"})).toBe("audio");
  expect(fileViewerKind({...file,fileName:"archive.zip"})).toBe("unsupported");
});
it("opens an unsaved image locally and frees its URL without calling the Office server", async () => {
  const local = new File(["image"], "selected.png", {type:"image/png"});
  const office = vi.fn();
  const view = render(wrap(<LocalFileViewer file={local} onClose={vi.fn()} onLoadOffice={office} />));
  expect(await screen.findByRole("img", {name:"selected.png"})).toHaveAttribute("src", "blob:preview");
  expect(office).not.toHaveBeenCalled();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});
it("renders Word content as escaped text and tables without loading the original",async()=>{
  const p=props(); render(wrap(<FileViewer {...p}/>));
  expect(await screen.findByText("<script>не исполнять</script>")).toBeInTheDocument();
  expect(document.querySelector(".file-viewer-document script")).toBeNull();
  expect(screen.getByRole("cell",{name:"ЦА"})).toBeInTheDocument();
  expect(p.onLoad).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Скачать"})); expect(p.onDownload).toHaveBeenCalledWith(file);
  fireEvent.click(screen.getByRole("button",{name:"Закрыть просмотрщик"})); expect(p.onClose).toHaveBeenCalled();
});
it("switches Excel sheets and loads rows in bounded pages",async()=>{
  const p=props({...file,fileName:"book.xlsx"}); p.onLoadOffice.mockResolvedValue(excel);
  render(wrap(<FileViewer {...p}/>));
  await screen.findByRole("table",{name:"Лист План"});
  fireEvent.click(screen.getByRole("button",{name:"Следующие строки"}));
  await waitFor(()=>expect(p.onLoadOffice).toHaveBeenLastCalledWith(p.attachment,0,200,expect.any(AbortSignal)));
  await screen.findByRole("table",{name:"Лист План"});
  fireEvent.click(screen.getByRole("button",{name:"Итоги"}));
  await waitFor(()=>expect(p.onLoadOffice).toHaveBeenLastCalledWith(p.attachment,1,0,expect.any(AbortSignal)));
});
it("offers retry after a failed load",async()=>{
  const p=props(); p.onLoadOffice.mockRejectedValueOnce(new Error("Сервер недоступен"));
  render(wrap(<FileViewer {...p}/>));
  expect(await screen.findByRole("alert")).toHaveTextContent("Сервер недоступен");
  fireEvent.click(screen.getByRole("button",{name:"Повторить"}));
  await screen.findByText("<script>не исполнять</script>");
  expect(p.onLoadOffice).toHaveBeenCalledTimes(2);
});
it("searches Word content and keeps Excel source row numbers",async()=>{
  const p=props(); const view=render(wrap(<FileViewer {...p}/>));
  await screen.findByText("<script>не исполнять</script>");
  fireEvent.change(screen.getByRole("textbox",{name:"Поиск в документе"}),{target:{value:"ЦА"}});
  expect(screen.queryByText("<script>не исполнять</script>")).not.toBeInTheDocument();
  expect(screen.getByRole("cell",{name:"ЦА"})).toBeInTheDocument();
  view.unmount();
  const e=props({...file,fileName:"book.xlsx"}); e.onLoadOffice.mockResolvedValue(excel);
  render(wrap(<FileViewer {...e}/>)); await screen.findByRole("table",{name:"Лист План"});
  fireEvent.change(screen.getByRole("textbox",{name:"Поиск на текущей странице листа"}),{target:{value:"Встреча"}});
  expect(screen.getByRole("rowheader",{name:"2"})).toBeInTheDocument();
  expect(screen.queryByRole("rowheader",{name:"1"})).not.toBeInTheDocument();
});
it("reports unsupported audio instead of leaving a silent player",async()=>{
  const p=props({...file,fileName:"song.mp3",contentType:"audio/mpeg"});
  render(wrap(<FileViewer {...p}/>));
  await waitFor(()=>expect(document.querySelector("audio")).not.toBeNull());
  fireEvent.error(document.querySelector("audio")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Аудиоформат не поддерживается");
});
it.each(["audio", "video"])("stops %s and clears its source on close",async kind=>{
  const p=props({...file,fileName:kind === "audio" ? "song.mp3" : "video.mp4",contentType:`${kind}/${kind === "audio" ? "mpeg" : "mp4"}`});
  const view=render(wrap(<FileViewer {...p}/>));
  await waitFor(()=>expect(document.querySelector(kind)).not.toBeNull());
  const element=document.querySelector(kind)!;
  expect(element).toHaveAttribute("src","blob:preview");
  view.unmount();
  expect(element).not.toHaveAttribute("src");
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
});
it("releases object URLs on close and ignores late responses",async()=>{
  const p=props({...file,fileName:"photo.png",contentType:"image/png"});
  const view=render(wrap(<FileViewer {...p}/>));
  await screen.findByRole("img",{name:"photo.png"}); view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  let resolve: ((blob: Blob)=>void)|undefined;
  p.onLoad.mockImplementation(()=>new Promise<Blob>(done=>{resolve=done;}));
  const late=render(wrap(<FileViewer {...p}/>)); late.unmount();
  vi.mocked(URL.createObjectURL).mockClear();
  await act(async()=>{resolve?.(new Blob(["late"]));});
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("does not download list attachments before the user opens them",()=>{
  const load=vi.fn(),open=vi.fn();
  render(wrap(<AttachmentChips attachments={[{...file,fileName:"photo.png",contentType:"image/png"}]} onLoad={load} onDownload={open}/>));
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Открыть изображение: photo.png"})); expect(open).toHaveBeenCalledOnce();
});
it("loads a photo thumbnail only while visible and aborts/releases it on exit",async()=>{
  let notify: (visible: boolean) => void = () => {};
  const disconnect=vi.fn();
  vi.stubGlobal("IntersectionObserver",class {
    constructor(callback: (entries: {isIntersecting:boolean}[])=>void) {notify=visible=>callback([{isIntersecting:visible}]);}
    observe() {}
    disconnect=disconnect;
  });
  const load=vi.fn().mockResolvedValue(new Blob(["photo"]));
  const view=render(wrap(<AttachmentChips attachments={[{...file,fileName:"photo.png",contentType:"image/png"}]} onLoad={load} onDownload={vi.fn()}/>));
  expect(load).not.toHaveBeenCalled();
  act(()=>notify(true));
  await screen.findByRole("img",{name:"photo.png"});
  const signal=load.mock.calls[0]![1] as AbortSignal;
  act(()=>notify(false));
  expect(signal.aborted).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  view.unmount(); expect(disconnect).toHaveBeenCalled();
});

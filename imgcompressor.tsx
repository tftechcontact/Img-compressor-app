import { useState, useCallback, useRef } from "react";
import imageCompression from "browser-image-compression";
import { useUser, useClerk, Show } from "@clerk/react";
import { useLocation } from "wouter";
import {
  UploadCloud, Image as ImageIcon, Download, Trash2, ArrowRight,
  LogOut, FolderOpen, FolderPlus, Lock, Pencil, Check, X,
  ChevronDown, MoveRight, Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ============================================================
//  PLACEHOLDERS — edit these to customize your app
// ============================================================

const APP_TITLE_STATIC    = "Shrink photos.";
const APP_TITLE_HIGHLIGHT = "Keep quality.";
const APP_TAGLINE         = "A fast, private, entirely client-side image compression tool. Your files never leave your browser.";
const DROPZONE_HEADING    = "Drop images here";
const DROPZONE_SUBTEXT    = "or click to browse from your computer. Supports JPEG, PNG, WebP.";

const DEFAULT_QUALITY      = 0.8;
const DEFAULT_MAX_SIZE_MB  = 1;
const DEFAULT_FORMAT       = "image/jpeg" as const;
const DEFAULT_MAX_DIMENSION = null;

const QUALITY_MIN  = 0.1;  const QUALITY_MAX  = 1.0;  const QUALITY_STEP  = 0.05;
const MAX_SIZE_MIN = 0.5;  const MAX_SIZE_MAX  = 10;   const MAX_SIZE_STEP = 0.5;

const DIMENSION_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Original", value: null },
  { label: "720p",     value: 720  },
  { label: "1080p",    value: 1080 },
  { label: "1440p",    value: 1440 },
  { label: "4K",       value: 2160 },
];

const FREE_PRESETS: { label: string; maxDimension: number; quality: number }[] = [
  { label: "Logo", maxDimension: 500, quality: 0.9 },
];

const MEMBER_PRESETS: { label: string; maxDimension: number; quality: number }[] = [
  { label: "YouTube Banner",  maxDimension: 2560, quality: 0.9  },
  { label: "Shopify Banner",  maxDimension: 1800, quality: 0.85 },
  { label: "Shopify Header",  maxDimension: 1800, quality: 0.85 },
  // { label: "Your Platform", maxDimension: 1200, quality: 0.85 },
];

// ============================================================

type OutputFormat = "image/jpeg" | "image/png" | "image/webp";

const FORMAT_OPTIONS: { label: string; value: OutputFormat; ext: string }[] = [
  { label: "JPEG", value: "image/jpeg", ext: "jpg" },
  { label: "PNG",  value: "image/png",  ext: "png" },
  { label: "WebP", value: "image/webp", ext: "webp" },
];

type FileItem = {
  id: string;
  originalFile: File;
  originalSize: number;
  originalUrl: string;
  compressedFile: File | null;
  compressedSize: number | null;
  compressedUrl: string | null;
  status: "pending" | "compressing" | "done" | "error";
  progress: number;
};

type SavedFile = {
  id: number;
  file_name: string;
  file_size: number;
  original_size: number;
  format: string;
  folder: string;
  created_at: string;
};

type FolderItem = {
  id: number;
  name: string;
  file_count: number;
  created_at: string;
};

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const ALL_FILES_KEY = "__all__";

export default function Home() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const isSignedIn = !!user;

  // compressor state
  const [files, setFiles] = useState<FileItem[]>([]);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [maxSizeMB, setMaxSizeMB] = useState(DEFAULT_MAX_SIZE_MB);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(DEFAULT_FORMAT);
  const [maxDimension, setMaxDimension] = useState<number | null>(DEFAULT_MAX_DIMENSION);
  const [isDragging, setIsDragging] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [saveToFolder, setSaveToFolder] = useState("General");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // folder/file browser state
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL_FILES_KEY);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: folders = [] } = useQuery<FolderItem[]>({
    queryKey: ["folders"],
    queryFn: async () => {
      const res = await fetch("/api/folders", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isSignedIn,
  });

  const filterParam = selectedFolder === ALL_FILES_KEY ? "" : `?folder=${encodeURIComponent(selectedFolder)}`;
  const { data: savedFiles = [] } = useQuery<SavedFile[]>({
    queryKey: ["saved-files", selectedFolder],
    queryFn: async () => {
      const res = await fetch(`/api/saved-files${filterParam}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isSignedIn,
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["saved-files"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: { file_name: string; file_size: number; original_size: number; format: string; folder: string }) => {
      const res = await fetch("/api/saved-files", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/saved-files/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: invalidate,
  });

  const moveFileMutation = useMutation({
    mutationFn: async ({ id, folder }: { id: number; folder: string }) => {
      await fetch(`/api/saved-files/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder }) });
    },
    onSuccess: invalidate,
  });

  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/folders", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await fetch(`/api/folders/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (_data, vars) => {
      if (selectedFolder !== ALL_FILES_KEY) setSelectedFolder(vars.name);
      invalidate();
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/folders/${id}`, { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moveFilesTo: "General" }) });
    },
    onSuccess: () => {
      setSelectedFolder(ALL_FILES_KEY);
      setDeletingId(null);
      invalidate();
    },
  });

  // ── Compression helpers ──────────────────────────────────────────────────
  const handleDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files?.length) processFiles(Array.from(e.dataTransfer.files));
  }, []);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) processFiles(Array.from(e.target.files));
  }, []);

  const processFiles = (newFiles: File[]) => {
    const items: FileItem[] = newFiles.filter(f => f.type.startsWith("image/")).map(file => ({
      id: Math.random().toString(36).substring(7),
      originalFile: file, originalSize: file.size,
      originalUrl: URL.createObjectURL(file),
      compressedFile: null, compressedSize: null, compressedUrl: null,
      status: "pending", progress: 0,
    }));
    setFiles(prev => [...prev, ...items]);
  };

  const removeFile = (id: string) => setFiles(prev => {
    const item = prev.find(f => f.id === id);
    if (item) { URL.revokeObjectURL(item.originalUrl); if (item.compressedUrl) URL.revokeObjectURL(item.compressedUrl); }
    return prev.filter(f => f.id !== id);
  });

  const formatSize = (bytes: number) => {
    if (!bytes) return "0 B";
    const k = 1024, s = ["B", "KB", "MB", "GB"], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + s[i];
  };

  const compressAll = async () => {
    for (const fi of files) {
      if (fi.status === "done" || fi.status === "compressing") continue;
      setFiles(prev => prev.map(f => f.id === fi.id ? { ...f, status: "compressing", progress: 10 } : f));
      try {
        const ext = FORMAT_OPTIONS.find(f => f.value === outputFormat)?.ext ?? "jpg";
        const blob = await imageCompression(fi.originalFile, {
          maxSizeMB, maxWidthOrHeight: maxDimension ?? 99999, useWebWorker: true,
          initialQuality: quality, fileType: outputFormat,
          onProgress: (p: number) => setFiles(prev => prev.map(f => f.id === fi.id ? { ...f, progress: p } : f)),
        });
        const cf = new File([blob], `${fi.originalFile.name.replace(/\.[^.]+$/, "")}.${ext}`, { type: outputFormat });
        setFiles(prev => prev.map(f => f.id === fi.id ? { ...f, compressedFile: cf, compressedSize: cf.size, compressedUrl: URL.createObjectURL(cf), status: "done", progress: 100 } : f));
      } catch {
        setFiles(prev => prev.map(f => f.id === fi.id ? { ...f, status: "error", progress: 0 } : f));
      }
    }
  };

  const downloadFile = (fi: FileItem) => {
    if (!fi.compressedUrl || !fi.compressedFile) return;
    const a = Object.assign(document.createElement("a"), { href: fi.compressedUrl, download: fi.compressedFile.name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleSaveToAccount = async (fi: FileItem) => {
    if (!isSignedIn) { setLocation(`${basePath}/sign-in`); return; }
    if (!fi.compressedFile || !fi.compressedSize) return;
    setSaveStatus(s => ({ ...s, [fi.id]: "saving" }));
    try {
      await saveMutation.mutateAsync({ file_name: fi.compressedFile.name, file_size: fi.compressedSize, original_size: fi.originalSize, format: outputFormat, folder: saveToFolder });
      setSaveStatus(s => ({ ...s, [fi.id]: "saved" }));
    } catch {
      setSaveStatus(s => ({ ...s, [fi.id]: "error" }));
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await createFolderMutation.mutateAsync(name);
    setNewFolderName(""); setCreatingFolder(false);
    setSelectedFolder(name);
  };

  const handleRename = async (id: number) => {
    const name = renameValue.trim();
    if (!name) return;
    await renameFolderMutation.mutateAsync({ id, name });
    setRenamingId(null);
  };

  const totalFiles = savedFiles.length;
  const folderFileCount = (name: string) => folders.find(f => f.name === name)?.file_count ?? 0;

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center bg-background px-4 pb-12 sm:px-8">

      {/* ── PLACEHOLDER: Top Ad Banner ──────────────────────────────────────
          Replace with your real ad embed (Google AdSense, Carbon Ads, etc.)
          Recommended: 728×90 leaderboard. Hide for members if desired. */}
      <div data-testid="ad-banner-top" className="w-full max-w-4xl mt-4 mb-2 h-14 rounded-lg border-2 border-dashed border-border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground/40 font-mono select-none">
        [ AD BANNER — top 728×90 ]
      </div>
      {/* ── END PLACEHOLDER ─────────────────────────────────────────────── */}

      <div className="w-full max-w-4xl space-y-10 pt-6">

        {/* Header */}
        <div className="relative text-center space-y-4">
          <div className="absolute right-0 top-0 flex items-center gap-2">
            <Show when="signed-out">
              <Button data-testid="button-login" variant="outline" size="sm" onClick={() => setLocation(`${basePath}/sign-in`)}>Log in</Button>
              <Button data-testid="button-signup" size="sm" onClick={() => setLocation(`${basePath}/sign-up`)}>Sign up</Button>
            </Show>
            <Show when="signed-in">
              <span className="text-sm text-muted-foreground hidden sm:inline truncate max-w-[140px]">{user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress}</span>
              <Button data-testid="button-signout" variant="ghost" size="sm" onClick={() => signOut()} className="text-muted-foreground gap-1">
                <LogOut className="w-4 h-4" /><span className="hidden sm:inline">Sign out</span>
              </Button>
            </Show>
          </div>
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-primary/10 mb-2">
            <ImageIcon className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            {APP_TITLE_STATIC} <br className="sm:hidden" />
            <span className="text-primary">{APP_TITLE_HIGHLIGHT}</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">{APP_TAGLINE}</p>
        </div>

        {/* Controls + Dropzone */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-1 border-border bg-card shadow-sm p-6 flex flex-col gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Quality</Label>
                  <span className="text-xs font-mono text-muted-foreground">{Math.round(quality * 100)}%</span>
                </div>
                <Slider data-testid="slider-quality" value={[quality]} onValueChange={v => setQuality(v[0])} max={QUALITY_MAX} step={QUALITY_STEP} min={QUALITY_MIN} className="py-2" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Max Size (MB)</Label>
                  <span className="text-xs font-mono text-muted-foreground">{maxSizeMB} MB</span>
                </div>
                <Slider data-testid="slider-max-size" value={[maxSizeMB]} onValueChange={v => setMaxSizeMB(v[0])} max={MAX_SIZE_MAX} step={MAX_SIZE_STEP} min={MAX_SIZE_MIN} className="py-2" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Output Format</Label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {FORMAT_OPTIONS.map(fmt => (
                    <button key={fmt.value} data-testid={`button-format-${fmt.ext}`} onClick={() => setOutputFormat(fmt.value)}
                      className={`flex-1 py-2 text-xs font-semibold transition-colors ${outputFormat === fmt.value ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}>
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Max Dimension</Label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {DIMENSION_OPTIONS.map(opt => (
                    <button key={String(opt.value)} data-testid={`button-dimension-${opt.label.toLowerCase()}`} onClick={() => setMaxDimension(opt.value)}
                      className={`flex-1 py-2 text-xs font-semibold transition-colors ${maxDimension === opt.value ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Platform Presets</Label>
                <div className="flex flex-wrap gap-2">
                  {FREE_PRESETS.map(p => (
                    <button key={p.label} data-testid={`button-preset-${p.label.toLowerCase().replace(/\s+/g, "-")}`}
                      onClick={() => { setMaxDimension(p.maxDimension); setQuality(p.quality); }}
                      className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${maxDimension === p.maxDimension && quality === p.quality ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}>
                      {p.label}
                    </button>
                  ))}
                  <Show when="signed-in">
                    {MEMBER_PRESETS.map(p => (
                      <button key={p.label} data-testid={`button-preset-${p.label.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={() => { setMaxDimension(p.maxDimension); setQuality(p.quality); }}
                        className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${maxDimension === p.maxDimension && quality === p.quality ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}>
                        {p.label}
                      </button>
                    ))}
                  </Show>
                  <Show when="signed-out">
                    <button data-testid="button-preset-member-locked" onClick={() => setLocation(`${basePath}/sign-in`)}
                      className="px-3 py-1.5 rounded-md border border-dashed border-border text-xs font-medium text-muted-foreground/50 flex items-center gap-1 hover:border-primary hover:text-primary transition-colors">
                      <Lock className="w-3 h-3" /> Member presets
                    </button>
                  </Show>
                </div>
              </div>
            </div>
            <Button data-testid="button-compress-all" onClick={compressAll} disabled={files.length === 0 || files.every(f => f.status === "done")} className="w-full font-semibold mt-auto h-12 text-base" size="lg">
              {files.some(f => f.status === "compressing") ? "Compressing..." : "Compress Images"}
            </Button>
          </Card>

          <div data-testid="dropzone-area"
            className={`md:col-span-2 relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 transition-all duration-200 cursor-pointer ${isDragging ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/5"}`}
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}>
            <input data-testid="input-file-picker" type="file" multiple accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
            <UploadCloud className={`w-12 h-12 mb-4 transition-colors ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
            <h3 className="text-xl font-semibold mb-2">{DROPZONE_HEADING}</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">{DROPZONE_SUBTEXT}</p>
          </div>
        </div>

        {/* Results */}
        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">Your Files</h2>
              <div className="flex items-center gap-2">
                {isSignedIn && files.some(f => f.status === "done") && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1 text-xs">
                        <Folder className="w-3.5 h-3.5" /> Save to: {saveToFolder} <ChevronDown className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setSaveToFolder("General")}>General</DropdownMenuItem>
                      {folders.map(f => (
                        <DropdownMenuItem key={f.id} onClick={() => setSaveToFolder(f.name)}>{f.name}</DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {files.some(f => f.status === "done") && (
                  <Button data-testid="button-download-all" variant="secondary" onClick={() => files.forEach(f => { if (f.status === "done") downloadFile(f); })}>
                    <Download className="w-4 h-4 mr-2" /> Download All
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {files.map(fi => (
                <Card key={fi.id} data-testid={`card-file-${fi.id}`} className="overflow-hidden">
                  <div className="flex flex-col sm:flex-row items-center p-4 gap-4">
                    <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-muted border border-border">
                      <img src={fi.originalUrl} alt="preview" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0 w-full">
                      <h4 className="font-medium text-sm truncate mb-1" title={fi.originalFile.name}>{fi.originalFile.name}</h4>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatSize(fi.originalSize)}</span>
                        {fi.status === "done" && fi.compressedSize && (
                          <>
                            <ArrowRight className="w-3 h-3 text-primary" />
                            <span className="font-semibold text-foreground">{formatSize(fi.compressedSize)}</span>
                            <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-medium">
                              -{(100 - (fi.compressedSize / fi.originalSize) * 100).toFixed(1)}%
                            </span>
                          </>
                        )}
                      </div>
                      {fi.status === "compressing" && (
                        <div className="mt-3 flex items-center gap-3">
                          <Progress value={fi.progress} className="h-1.5 flex-1" />
                          <span className="text-xs font-mono text-muted-foreground w-8 text-right">{Math.round(fi.progress)}%</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {fi.status === "done" ? (
                        <>
                          <Button data-testid={`button-download-${fi.id}`} variant="default" size="sm" onClick={() => downloadFile(fi)} className="gap-2">
                            <Download className="w-4 h-4" /><span className="hidden sm:inline">Download</span>
                          </Button>
                          <Button data-testid={`button-save-account-${fi.id}`} variant="outline" size="sm"
                            onClick={() => handleSaveToAccount(fi)}
                            disabled={saveStatus[fi.id] === "saving" || saveStatus[fi.id] === "saved"}
                            className="text-xs">
                            {saveStatus[fi.id] === "saved" ? "Saved!" : saveStatus[fi.id] === "saving" ? "Saving..." : isSignedIn ? `Save to ${saveToFolder}` : "Members only"}
                          </Button>
                        </>
                      ) : fi.status === "pending" ? (
                        <div className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium">Ready</div>
                      ) : null}
                      <Button data-testid={`button-remove-${fi.id}`} variant="ghost" size="icon" onClick={() => removeFile(fi.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Saved Files & Folders ─────────────────────────────────────────── */}
        <Show when="signed-in">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-primary" />
                <h2 className="text-2xl font-bold tracking-tight">My Library</h2>
              </div>
              <Button data-testid="button-new-folder" variant="outline" size="sm" className="gap-1.5 text-xs"
                onClick={() => { setCreatingFolder(true); setNewFolderName(""); }}>
                <FolderPlus className="w-4 h-4" /> New Folder
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Folder sidebar */}
              <div className="md:col-span-1 space-y-1">
                <button
                  data-testid="folder-all"
                  onClick={() => setSelectedFolder(ALL_FILES_KEY)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${selectedFolder === ALL_FILES_KEY ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground"}`}>
                  <span className="flex items-center gap-2"><Folder className="w-4 h-4" /> All Files</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${selectedFolder === ALL_FILES_KEY ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {folders.reduce((s, f) => s + f.file_count, 0)}
                  </span>
                </button>

                {folders.map(folder => (
                  <div key={folder.id} className="group relative">
                    {renamingId === folder.id ? (
                      <div className="flex items-center gap-1 px-1 py-1">
                        <Input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") handleRename(folder.id); if (e.key === "Escape") setRenamingId(null); }}
                          className="h-7 text-xs"
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => handleRename(folder.id)}><Check className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setRenamingId(null)}><X className="w-3.5 h-3.5" /></Button>
                      </div>
                    ) : deletingId === folder.id ? (
                      <div className="px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/5 text-xs space-y-2">
                        <p className="font-medium text-destructive">Delete "{folder.name}"?</p>
                        <p className="text-muted-foreground">Files will be moved to General.</p>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => deleteFolderMutation.mutate(folder.id)}>Delete</Button>
                          <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setDeletingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        data-testid={`folder-${folder.name.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={() => setSelectedFolder(folder.name)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${selectedFolder === folder.name ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground"}`}>
                        <span className="flex items-center gap-2 truncate"><Folder className="w-4 h-4 shrink-0" /><span className="truncate">{folder.name}</span></span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${selectedFolder === folder.name ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                          {folder.file_count}
                        </span>
                      </button>
                    )}
                    {renamingId !== folder.id && deletingId !== folder.id && (
                      <div className="absolute right-1 top-1 hidden group-hover:flex items-center gap-0.5">
                        <button onClick={e => { e.stopPropagation(); setRenamingId(folder.id); setRenameValue(folder.name); }}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); setDeletingId(folder.id); }}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {creatingFolder && (
                  <div className="flex items-center gap-1 px-1 py-1">
                    <Input
                      autoFocus
                      placeholder="Folder name…"
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setCreatingFolder(false); }}
                      className="h-7 text-xs"
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleCreateFolder}><Check className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setCreatingFolder(false)}><X className="w-3.5 h-3.5" /></Button>
                  </div>
                )}
              </div>

              {/* File list */}
              <div className="md:col-span-3">
                {savedFiles.length === 0 ? (
                  <div className="border-2 border-dashed border-border rounded-xl p-10 text-center text-muted-foreground h-full flex flex-col items-center justify-center gap-2">
                    <Folder className="w-8 h-8 text-muted-foreground/30" />
                    <p className="text-sm">
                      {selectedFolder === ALL_FILES_KEY
                        ? "No saved files yet. Compress an image and click \"Save to Account\"."
                        : `No files in "${selectedFolder}" yet.`}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground px-1">{totalFiles} file{totalFiles !== 1 ? "s" : ""} {selectedFolder !== ALL_FILES_KEY ? `in "${selectedFolder}"` : "total"}</p>
                    {savedFiles.map(sf => (
                      <Card key={sf.id} data-testid={`card-saved-${sf.id}`} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{sf.file_name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatSize(sf.original_size)} → {formatSize(sf.file_size)}
                            <span className="mx-1.5">·</span>{sf.format.split("/")[1].toUpperCase()}
                            <span className="mx-1.5">·</span>{new Date(sf.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1">
                                <MoveRight className="w-3.5 h-3.5" /> Move <ChevronDown className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => moveFileMutation.mutate({ id: sf.id, folder: "General" })}>General</DropdownMenuItem>
                              {folders.filter(f => f.name !== sf.folder).map(f => (
                                <DropdownMenuItem key={f.id} onClick={() => moveFileMutation.mutate({ id: sf.id, folder: f.name })}>{f.name}</DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button data-testid={`button-delete-saved-${sf.id}`} variant="ghost" size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => deleteFileMutation.mutate(sf.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Show>

        <Show when="signed-out">
          <div className="border-2 border-dashed border-border rounded-xl p-10 text-center space-y-3">
            <FolderOpen className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-muted-foreground font-medium">Save and organize your compressed images</p>
            <p className="text-sm text-muted-foreground/60">Members can save files to folders and unlock platform presets.</p>
            <div className="flex gap-2 justify-center mt-2">
              <Button data-testid="button-cta-signup" onClick={() => setLocation(`${basePath}/sign-up`)}>Become a member</Button>
              <Button data-testid="button-cta-login" variant="outline" onClick={() => setLocation(`${basePath}/sign-in`)}>Log in</Button>
            </div>
          </div>
        </Show>

      </div>

      {/* ── PLACEHOLDER: Bottom Ad Banner ───────────────────────────────────
          Replace with your real ad embed (Google AdSense, Carbon Ads, etc.)
          Recommended: 728×90 leaderboard or 300×250 rectangle. */}
      <div data-testid="ad-banner-bottom" className="w-full max-w-4xl mt-10 h-20 rounded-lg border-2 border-dashed border-border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground/40 font-mono select-none">
        [ AD BANNER — bottom 728×90 ]
      </div>
      {/* ── END PLACEHOLDER ─────────────────────────────────────────────── */}

    </div>
  );
}

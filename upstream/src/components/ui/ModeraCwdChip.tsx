import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, ShieldCheck, ShieldOff } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { getModelsOnce } from '../../lib/use-models';
import { moderaFrontend } from '../../lib/modera-bridge';
import { setProjectAgentCwd, setProjectAgentGuard, useProjects } from '../../store/projects';

const tail = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** The native Modera route has its own directory picker and per-run boundary. */
export default function ModeraCwdChip() {
  const selectedModel = useUiStore(state => state.selectedModel);
  const activeId = useProjects(state => state.activeId);
  const projects = useProjects(state => state.projects);
  const [open, setOpen] = useState(false);
  const [codex, setCodex] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const meta = projects.find(project => project.id === activeId);
  const recent = [...new Set(projects.map(project => project.agentCwd).filter((path): path is string => !!path))]
    .filter(path => path !== meta?.agentCwd).slice(0, 5);
  const zh = document.documentElement.lang.toLowerCase().startsWith('zh');

  useEffect(() => {
    let alive = true;
    void getModelsOnce().then(data => {
      if (!alive) return;
      const id = selectedModel === 'modera/native' ? data?.default : selectedModel;
      setCodex(data?.models.find(model => model.id === id)?.agentRuntime === 'codex');
    });
    return () => { alive = false; };
  }, [selectedModel]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  if (!moderaFrontend || !activeId) return null;

  const choose = async (path: string | undefined) => {
    await setProjectAgentCwd(activeId, path);
    setOpen(false);
  };
  const guard = async (mode: 'ask' | 'allow') => {
    await setProjectAgentGuard(activeId, { mode, allow: [] });
    setOpen(false);
  };
  return (
    <div ref={root} className="relative">
      <button onClick={() => setOpen(value => !value)}
        className="bg-card/90 backdrop-blur border border-line rounded-lg h-8 px-2.5 flex items-center gap-1.5 shadow-sm hover:bg-wash transition-colors text-xs text-ink max-w-[220px]"
        title={meta?.agentCwd ?? (zh ? '画布工作区' : 'Canvas workspace')}
        data-modera-cwd>
        <FolderOpen size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" />
        <span className="truncate">{meta?.agentCwd ? tail(meta.agentCwd) : (zh ? '画布工作区' : 'Canvas workspace')}</span>
        <ChevronDown size={12} strokeWidth={1.75} className="text-ink-faint shrink-0" />
      </button>
      {open && <div className="absolute right-0 top-full mt-1.5 w-[320px] bg-card border border-line rounded-xl shadow-lg py-1.5 z-50 animate-fade-in" onClick={event => event.stopPropagation()}>
        <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-1 pb-1">{zh ? '工作目录' : 'Working directory'}</p>
        <button onClick={() => void choose(undefined)} className="w-full text-left px-3 py-2 text-xs hover:bg-wash flex items-center gap-2">
          <span className="flex-1 min-w-0"><span className="block text-ink">{zh ? '画布工作区' : 'Canvas workspace'}</span><span className="block text-2xs text-ink-faint">{zh ? '这张画布专用的目录' : 'A dedicated folder for this canvas'}</span></span>
          {!meta?.agentCwd && <Check size={13} className="text-accent shrink-0" />}
        </button>
        {meta?.agentCwd && <button onClick={() => void choose(meta.agentCwd)} className="w-full text-left px-3 py-2 text-xs hover:bg-wash flex items-center gap-2">
          <span className="flex-1 min-w-0"><span className="block text-ink">{tail(meta.agentCwd)}</span><span className="block text-2xs text-ink-faint truncate">{meta.agentCwd}</span></span>
          <Check size={13} className="text-accent shrink-0" />
        </button>}
        {recent.length > 0 && <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-2 pb-1">{zh ? '最近使用' : 'Recent'}</p>}
        {recent.map(path => <button key={path} onClick={() => void choose(path)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-center gap-2">
          <span className="flex-1 min-w-0"><span className="block text-ink">{tail(path)}</span><span className="block text-2xs text-ink-faint truncate">{path}</span></span>
        </button>)}
        <div className="border-t border-line/60 my-1" />
        <button onClick={() => { void moderaFrontend?.pickWorkspaceDirectory().then(path => { if (path) void choose(path); }); }} className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-wash flex items-center gap-2" data-modera-cwd-pick>
          <FolderOpen size={14} className="text-ink-faint shrink-0" /> {zh ? '选择文件夹…' : 'Choose folder…'}
        </button>
        {codex && <>
          <div className="border-t border-line/60 my-1" />
          <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-1 pb-1">{zh ? '工作目录之外的操作 · Codex' : 'Outside workspace · Codex'}</p>
          <button onClick={() => void guard('ask')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-center gap-2" data-modera-guard="ask">
            <ShieldCheck size={14} className="text-ink-faint shrink-0" /><span className="flex-1 text-ink">{zh ? '每次询问' : 'Ask each time'}</span>
            {(meta?.agentGuard?.mode ?? 'ask') === 'ask' && <Check size={13} className="text-accent shrink-0" />}
          </button>
          <button onClick={() => void guard('allow')} className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-center gap-2" data-modera-guard="allow">
            <ShieldOff size={14} className="text-ink-faint shrink-0" /><span className="flex-1 text-ink">{zh ? '直接放行（每次执行需确认）' : 'Allow directly (confirm each run)'}</span>
            {meta?.agentGuard?.mode === 'allow' && <Check size={13} className="text-accent shrink-0" />}
          </button>
        </>}
      </div>}
    </div>
  );
}

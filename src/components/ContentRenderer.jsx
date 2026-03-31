import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTheme } from '@/context/ThemeContext';
import Spoiler from '@/components/Spoiler';
import { buildEmojiUrl, getEmojiCategory } from '@/config/emoji';

const ContentRenderer = ({ content, activeTag, onTagClick }) => {
  const { themeColor, currentFont } = useTheme();
  // 解析内容，分离文本和标签
  const parseContent = (text) => {
    const parts = [];
    let lastIndex = 0;
    
    // 匹配标签的正则表达式
    const tagRegex = /(?:^|\s)(#[\u4e00-\u9fa5a-zA-Z0-9_\/]+)/g;
    let match;
    
    while ((match = tagRegex.exec(text)) !== null) {
      // 添加标签前的文本
      if (match.index > lastIndex) {
        const beforeText = text.substring(lastIndex, match.index);
        if (beforeText) {
          parts.push({
            type: 'text',
            content: beforeText
          });
        }
      }
      
      // 添加空格（如果标签前有空格）
      const spaceMatch = text.substring(match.index, match.index + match[0].length - match[1].length);
      if (spaceMatch) {
        parts.push({
          type: 'text',
          content: spaceMatch
        });
      }
      
      // 添加标签
      const tagContent = match[1]; // #标签内容
      const tagName = tagContent.substring(1); // 去掉#�?
      parts.push({
        type: 'tag',
        content: tagContent,
        tagName: tagName
      });
      
      lastIndex = match.index + match[0].length;
    }
    
    // 添加剩余文本
    if (lastIndex < text.length) {
      parts.push({
        type: 'text',
        content: text.substring(lastIndex)
      });
    }
    
    return parts;
  };

  // 渲染markdown文本（不包含标签�?
  const renderMarkdownText = (text) => {
    let processedText = text;

    processedText = processedText.replace(/\\n/g, '\n');

    // 保留行首的空格 - 直接使用unicode非断行空格
    processedText = processedText.replace(/^( +)/gm, (match, spaces) => {
      // 将行首空格替换为unicode非断行空格
      return spaces.split('').map(() => '\u00A0').join('');
    });

    // 转换标题语法
    processedText = processedText.replace(/(?:^|\s)#([^\s#][^\n]*)/g, (match, p1) => {
      // 检查是否是标签
      const isTag = /^[\u4e00-\u9fa5a-zA-Z0-9_\/]+$/.test(p1);

      if (isTag) {
        return match; // 保留标签不变
      }

      // 否则替换为markdown标题格式
      return `${match[0] === ' ' ? ' ' : ''}# ${p1}`;
    });

    return processedText;
  };

  // 解析并按自定�?spoiler 语法分割文本
  // 语法�?
  // {% spoiler 文本 %}
  // {% spoiler style:box 文本 %}
  // {% spoiler style:box color:red 文本 %}
  const splitBySpoilers = (text) => {
    const result = [];
    const re = /{%\s*spoiler\b([\s\S]*?)%}/g; // 非贪婪匹配到 %}
    let lastIndex = 0;
    let m;

    while ((m = re.exec(text)) !== null) {
      const before = text.slice(lastIndex, m.index);
      if (before) result.push({ kind: 'text', value: before });

      const inner = (m[1] || '').trim();
      // 解析参数与内�?
      let styleType = 'blur';
      let color;
      let content = inner;

      // 尝试提取前部�?key:value 选项（顺序不限），直到遇到第一个非 key:value 开头的 token
      // 用简单扫描避免把内容里的冒号误判：仅接受 style: �?color: 两种 key
      const tokens = inner.split(/\s+/);
      let consumed = 0;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (/^style:/i.test(t)) {
          const v = t.split(':')[1]?.toLowerCase();
          if (v === 'box' || v === 'blur') styleType = v;
          consumed = i + 1;
          continue;
        }
        if (/^color:/i.test(t)) {
          color = t.slice(t.indexOf(':') + 1);
          consumed = i + 1;
          continue;
        }
        // 第一个非选项，剩余全部作为内�?
        break;
      }
      if (consumed > 0 && consumed < tokens.length) {
        content = tokens.slice(consumed).join(' ');
      } else if (consumed === tokens.length) {
        // 只有参数没有内容，降级为空字符串
        content = '';
      }

      result.push({ kind: 'spoiler', styleType, color, value: content });
      lastIndex = re.lastIndex;
    }
    const rest = text.slice(lastIndex);
    if (rest) result.push({ kind: 'text', value: rest });
    return result;
  };

  // 解析并按自定义原�?HTML 片段分割文本
  // 语法：```__html\n ... 任意 HTML ... \n```
  const splitByRawHtml = (text) => {
    const result = [];
    const re = /```__html\s*\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIndex) {
        result.push({ kind: 'text', value: text.slice(lastIndex, m.index) });
      }
      const html = (m[1] || '').trim();
      result.push({ kind: 'rawhtml', value: html });
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) {
      result.push({ kind: 'text', value: text.slice(lastIndex) });
    }
    return result;
  };

  const parts = parseContent(content);
  const { darkMode } = useTheme();

  useEffect(() => {
    if (!window.hljs && !window.__hljsLoading) {
      window.__hljsLoading = true;
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js';
      s.onload = () => { window.__hljsLoading = false; };
      document.head.appendChild(s);
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css';
      document.head.appendChild(l);
    }
    
    if (!window.mermaid && !window.__mermaidLoading) {
      window.__mermaidLoading = true;
      const ms = document.createElement('script');
      ms.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
      ms.onload = () => { 
        window.__mermaidLoading = false;
        if (window.mermaid) {
          window.mermaid.initialize({ 
            startOnLoad: false, 
            theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
            securityLevel: 'loose'
          });
          // Dispatch event to re-render mermaid diagrams
          window.dispatchEvent(new Event('mermaid-loaded'));
        }
      };
      document.head.appendChild(ms);
    }
  }, []);

  // Update mermaid theme when dark mode changes
  useEffect(() => {
    if (window.mermaid) {
      window.mermaid.initialize({ 
        theme: darkMode ? 'dark' : 'default'
      });
      window.dispatchEvent(new Event('mermaid-theme-changed'));
    }
  }, [darkMode]);

  const MermaidBlock = ({ text }) => {
    const [svg, setSvg] = useState('');
    const [error, setError] = useState(false);
    // 使用固定的随机ID，避免每次渲染都生成新的
    const idRef = React.useRef(`mermaid-${Math.random().toString(36).substr(2, 9)}`);

    const renderMermaid = async () => {
      if (window.mermaid && text) {
        try {
          // 清除可能存在的旧节点，避免冲突
          const oldNode = document.getElementById(idRef.current);
          if (oldNode && oldNode.parentNode) {
            oldNode.parentNode.removeChild(oldNode);
          }
          
          // 创建一个临时的包裹元素来进行渲染
          // ⚠️ 关键修复：Mermaid 在渲染连线和标签时，需要计算 SVG 元素的 BoundingBox (getBBox)
          // 解决方案：将其移出屏幕可视区域，但保持其渲染能力，并在DOM树的更安全的位置挂载
          const tempContainer = document.createElement('div');
          tempContainer.id = idRef.current;
          tempContainer.style.position = 'absolute';
          tempContainer.style.top = '-9999px';
          tempContainer.style.left = '-9999px';
          tempContainer.style.visibility = 'hidden';
          // 确保它有足够的宽度进行布局
          tempContainer.style.width = '1000px'; 
          
          // 必须添加到 document.body 才能正确计算尺寸
          const targetParent = document.body || document.documentElement;
          if (targetParent) {
            targetParent.appendChild(tempContainer);
          } else {
            throw new Error("No DOM element available to append Mermaid container");
          }
          
          // 尝试渲染
          // mermaid.render 在新版本中的签名是: render(id, text, container?)
          // 但有时容器可能还没有准备好，我们可以只传 id 和 text
          const { svg: svgCode } = await window.mermaid.render(idRef.current, text);
          
          // 渲染完成后移除临时节点
          if (tempContainer && tempContainer.parentNode) {
            tempContainer.parentNode.removeChild(tempContainer);
          }
          
          setSvg(svgCode);
          setError(false);
        } catch (e) {
          console.error('Mermaid render error:', e);
          // 清理可能遗留的失败节点
          const failedNode = document.getElementById(idRef.current);
          if (failedNode && failedNode.parentNode) {
            failedNode.parentNode.removeChild(failedNode);
          }
          // 不标记为完全失败，可能只是mermaid内部计算偶发错误，我们可以在下次重试
          // 只有当真正的语法错误时才抛出错误状态
          if (e.message && (e.message.includes('Parse error') || e.message.includes('Syntax error'))) {
            setError(true);
          }
        }
      }
    };

    useEffect(() => {
      renderMermaid();
      
      const handleMermaidLoaded = () => renderMermaid();
      window.addEventListener('mermaid-loaded', handleMermaidLoaded);
      window.addEventListener('mermaid-theme-changed', handleMermaidLoaded);
      
      return () => {
        window.removeEventListener('mermaid-loaded', handleMermaidLoaded);
        window.removeEventListener('mermaid-theme-changed', handleMermaidLoaded);
      };
    }, [text]);

    if (error) {
      return (
        <div className="my-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm border border-red-200 dark:border-red-800">
          <div className="font-bold mb-2">Failed to render Mermaid diagram. Please check your syntax:</div>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">{text}</pre>
        </div>
      );
    }

    if (!svg) {
      return (
        <div className="my-4 p-8 text-center text-gray-400 dark:text-gray-500 text-sm bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800 animate-pulse flex flex-col items-center justify-center gap-3">
          <svg className="w-6 h-6 animate-spin text-gray-300 dark:text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Rendering diagram...
        </div>
      );
    }

    return (
      <div 
        className="my-4 flex justify-center overflow-x-auto bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700"
        dangerouslySetInnerHTML={{ __html: svg }} 
      />
    );
  };

  const CodeBlock = ({ text, lang }) => {
    const [copied, setCopied] = useState(false);
    let html = '';
    if (window.hljs) {
      if (lang) {
        try { html = window.hljs.highlight(text, { language: lang }).value; } catch { html = window.hljs.highlightAuto(text).value; }
      } else {
        html = window.hljs.highlightAuto(text).value;
      }
    }
    const label = (lang || 'text').toUpperCase();
    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {}
    };
    return (
      <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center justify-between px-3 py-2 text-[11px] text-gray-600 dark:text-gray-300">
          <span className="uppercase tracking-wide">{label}</span>
          <button onClick={onCopy} className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {html ? (
          <pre className="px-3 pb-3 overflow-x-auto"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
        ) : (
          <pre className="px-3 pb-3 overflow-x-auto"><code>{text}</code></pre>
        )}
      </div>
    );
  };

  return (
    <div className={`prose prose-sm prose-p:my-1 prose-h1:my-1 prose-h2:my-1 prose-h3:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 max-w-none dark:prose-invert ${currentFont !== 'default' ? 'custom-font-content' : ''}`}>
      {parts.map((part, index) => {
        if (part.type === 'tag') {
          const isSecondLevel = part.tagName.includes('/');
          const [parentTag, childTag] = isSecondLevel ? part.tagName.split('/') : [part.tagName, null];
          const isActive = part.tagName === activeTag;
          
          return (
            <span
              key={index}
              onClick={() => onTagClick(part.tagName === activeTag ? null : part.tagName)}
              className={`inline-block text-xs px-2 py-1 rounded-full cursor-pointer transition-colors mx-1 border ${
                isActive
                  ? ''
                  : isSecondLevel
                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700 dark:hover:bg-blue-800/30'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 dark:border-gray-600'
              }`}
              style={isActive ? {
                backgroundColor: `${themeColor}20`,
                color: themeColor,
                borderColor: themeColor
              } : {}}
              title={part.content}
            >
              {isSecondLevel ? (
                <>
                  <span className="text-gray-500">#{parentTag}/</span>
                  <span className="font-medium">{childTag}</span>
                </>
              ) : (
                part.content
              )}
            </span>
          );
        } else {
          // 渲染文本部分：支�?__html 原样 HTML + spoiler + markdown
          const rawSegments = splitByRawHtml(part.content);
          return (
            <>
              {rawSegments.map((rawSeg, rawIdx) => {
                if (rawSeg.kind === 'rawhtml') {
                  // 直接渲染原样 HTML（来�?```__html ... ``` 块）
                  return (
                    <div key={`${index}-raw-${rawIdx}`} dangerouslySetInnerHTML={{ __html: rawSeg.value }} />
                  );
                }

                // 普通文本：先按 spoiler 切分，再交给 ReactMarkdown
                const segments = splitBySpoilers(rawSeg.value);
                const remarkEmojiShortcode = () => (tree) => {
                  const EMOJI_RE = /:([a-z0-9]+)_([a-z0-9_\-]+):/gi;
                  const isSkippableParent = (parent) => parent && (parent.type === 'code' || parent.type === 'inlineCode' || parent.type === 'link' || parent.type === 'image');
                  const walk = (node, parent) => {
                    if (!node || isSkippableParent(parent)) return;
                    if (Array.isArray(node.children)) {
                      // iterate copy because we'll modify
                      for (let i = 0; i < node.children.length; i++) {
                        const child = node.children[i];
                        if (child.type === 'text' && typeof child.value === 'string') {
                          const value = child.value;
                          let match;
                          let lastIndex = 0;
                          const newChildren = [];
                          while ((match = EMOJI_RE.exec(value)) !== null) {
                            const before = value.slice(lastIndex, match.index);
                            if (before) newChildren.push({ type: 'text', value: before });
                            const cat = (match[1] || '').toLowerCase();
                            const name = (match[2] || '').toLowerCase();
                            if (getEmojiCategory(cat)) {
                              const url = buildEmojiUrl(cat, name, 'png');
                              newChildren.push({ type: 'image', url, title: null, alt: `emoji:${cat}_${name}` });
                            } else {
                              // not supported category: keep original text
                              newChildren.push({ type: 'text', value: match[0] });
                            }
                            lastIndex = match.index + match[0].length;
                          }
                          if (newChildren.length > 0) {
                            const rest = value.slice(lastIndex);
                            if (rest) newChildren.push({ type: 'text', value: rest });
                            // replace current child with newChildren list
                            node.children.splice(i, 1, ...newChildren);
                            i += newChildren.length - 1;
                          }
                        } else {
                          walk(child, node);
                        }
                      }
                    }
                  };
                  walk(tree, null);
                };

                if (segments.length === 1 && segments[0].kind === 'text') {
                  return (
                    <ReactMarkdown
                      key={`${index}-md-${rawIdx}`}
                      components={{
                        h1: ({node, ...props}) => <h1 className="text-xl font-bold my-1" {...props} />,
                        h2: ({node, ...props}) => <h2 className="text-lg font-bold my-1" {...props} />,
                        h3: ({node, ...props}) => <h3 className="text-md font-bold my-1" {...props} />,
                        p: ({node, ...props}) => <div className="whitespace-pre-wrap break-words mb-1 custom-font-content" {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc pl-5 my-1" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal pl-5 my-1" {...props} />,
                        li: ({node, className, children, ...props}) => {
                          const isTask = className && className.includes('task-list-item');
                          return (
                            <li className={`my-0.5 ${isTask ? 'flex items-start gap-2 list-none -ml-5' : ''}`} {...props}>
                              {children}
                            </li>
                          );
                        },
                        input: ({node, type, checked, ...props}) => {
                          if (type === 'checkbox') {
                            return (
                              <input 
                                type="checkbox" 
                                checked={checked} 
                                readOnly 
                                className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-70 cursor-not-allowed"
                                {...props} 
                              />
                            );
                          }
                          return <input type={type} {...props} />;
                        },
                        strong: ({node, ...props}) => <strong className="font-bold" {...props} />,
                        em: ({node, ...props}) => <em className="italic" {...props} />,
                        br: () => <br />,
                        img: ({node, ...props}) => {
                          const isEmoji = (props?.alt || '').startsWith('emoji:') || (props?.src || '').includes('/emoji/');
                          if (isEmoji) {
                            const alt = props?.alt || '';
                            const m = alt.match(/^emoji:([a-z0-9]+)_([a-z0-9_\-]+)/i);
                            const cat = m ? m[1] : null;
                            const name = m ? m[2] : null;
                            return (
                              <img
                                {...props}
                                style={{ height: '1em', width: 'auto', verticalAlign: '-0.2em', display: 'inline-block', margin: '0 0.1em', ...(props.style || {}) }}
                                onError={(e) => {
                                  if (!cat || !name) return;
                                  const currentExt = (e.currentTarget.src.match(/\.(\w+)(?:\?|#|$)/) || [,''])[1];
                                  const order = ['png', 'webp', 'gif'];
                                  const rest = order.filter(x => x !== currentExt);
                                  for (const ext of rest) {
                                    const candidate = buildEmojiUrl(cat, name, ext);
                                    if (e.currentTarget.src !== candidate) {
                                      e.currentTarget.src = candidate;
                                      return;
                                    }
                                  }
                                }}
                              />
                            );
                          }
                          return <img {...props} />;
                        },
                        pre: ({node, children, ...props}) => {
                          // Extract code element from pre children
                          let codeElement = children;
                          if (Array.isArray(children)) {
                            codeElement = children.find(c => c && c.type === 'code');
                          }
                          if (!codeElement || !codeElement.props) {
                            return <pre {...props}>{children}</pre>;
                          }
                          
                          const codeProps = codeElement.props;
                          const raw = String(codeProps.children || '');
                          const text = raw.replace(/\\n/g, '\n').replace(/\n$/, '');
                          const className = codeProps.className || '';
                          const m = /language-([\w-]+)/.exec(className);
                          const lang = m ? m[1] : null;
                          
                          if (lang === 'mermaid') {
                            return <MermaidBlock text={text} />;
                          }
                          
                          return <CodeBlock text={text} lang={lang} />;
                        },
                        code: ({node, className, children, ...props}) => {
                          const raw = String(children || '');
                          const text = raw.replace(/\\n/g, '\n');
                          return <code className="px-1.5 py-0.5 mx-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono text-sm border border-gray-200 dark:border-gray-700 whitespace-pre-wrap break-words" {...props}>{text}</code>;
                        },
                      }}
                      remarkPlugins={[remarkEmojiShortcode]}
                      rehypePlugins={[]}
                    >
                      {renderMarkdownText(segments[0].value)}
                    </ReactMarkdown>
                  );
                }

                // 多段（含 spoiler）的情况：处理前后换行与拼接
                let pendingBreaks = 0;
                let lastWasSpoiler = false;
                return (
                  <React.Fragment key={`${index}-mdsp-${rawIdx}`}>
                    {segments.map((seg, i) => {
                      const renderBreaks = (count, keyPrefix) => Array.from({ length: count }, (_, k) => <br key={`${index}-${keyPrefix}-${rawIdx}-${i}-${k}`} />);

                      if (seg.kind === 'spoiler') {
                        const beforeEls = [];
                        if (pendingBreaks > 0) {
                          beforeEls.push(...renderBreaks(pendingBreaks, 'pb'));
                          pendingBreaks = 0;
                        }
                        const el = (
                          <span key={`${index}-sp-wrap-${rawIdx}-${i}`}>
                            {beforeEls}
                            <Spoiler text={seg.value} styleType={seg.styleType} color={seg.color} />
                          </span>
                        );
                        lastWasSpoiler = true;
                        return el;
                      }

                      const prefixEls = [];
                      if (pendingBreaks > 0) {
                        prefixEls.push(...renderBreaks(pendingBreaks, 'pb'));
                        pendingBreaks = 0;
                      }

                      const leading = seg.value.match(/^[ \t]*\n+/);
                      const leadingBreaks = leading ? (leading[0].match(/\n/g) || []).length : 0;
                      if (leadingBreaks > 0) {
                        prefixEls.push(...renderBreaks(leadingBreaks, 'lb'));
                      } else if (lastWasSpoiler) {
                        prefixEls.push(' ');
                      }

                      let inner = seg.value.replace(/^[ \t]*\n+/, '');
                      const trailing = inner.match(/\n+[ \t]*$/);
                      const trailingBreaks = trailing ? (trailing[0].match(/\n/g) || []).length : 0;
                      inner = inner.replace(/\n+[ \t]*$/, '');

                      const node = (
                        <span key={`${index}-tx-wrap-${rawIdx}-${i}`}>
                          {prefixEls}
                          <ReactMarkdown
                            components={{
                              h1: ({node, ...props}) => <h1 className="text-xl font-bold my-1" {...props} />,
                              h2: ({node, ...props}) => <h2 className="text-lg font-bold my-1" {...props} />,
                              h3: ({node, ...props}) => <h3 className="text-md font-bold my-1" {...props} />,
                              p: ({node, ...props}) => <div className="whitespace-pre-wrap break-words mb-1 custom-font-content" {...props} />,
                              ul: ({node, ...props}) => <ul className="list-disc pl-5 my-1" {...props} />,
                              ol: ({node, ...props}) => <ol className="list-decimal pl-5 my-1" {...props} />,
                              li: ({node, ...props}) => <li className="my-0.5" {...props} />,
                              strong: ({node, ...props}) => <strong className="font-bold" {...props} />,
                              em: ({node, ...props}) => <em className="italic" {...props} />,
                              br: () => <br />,
                              img: ({node, ...props}) => {
                                const isEmoji = (props?.alt || '').startsWith('emoji:') || (props?.src || '').includes('/emoji/');
                                if (isEmoji) {
                                  const alt = props?.alt || '';
                                  const m = alt.match(/^emoji:([a-z0-9]+)_([a-z0-9_\-]+)/i);
                                  const cat = m ? m[1] : null;
                                  const name = m ? m[2] : null;
                                  return (
                                    <img
                                      {...props}
                                      style={{ height: '1em', width: 'auto', verticalAlign: '-0.2em', display: 'inline-block', margin: '0 0.1em', ...(props.style || {}) }}
                                      onError={(e) => {
                                        if (!cat || !name) return;
                                        const currentExt = (e.currentTarget.src.match(/\.(\w+)(?:\?|#|$)/) || [,''])[1];
                                        const order = ['png', 'webp', 'gif'];
                                        const rest = order.filter(x => x !== currentExt);
                                        for (const ext of rest) {
                                          const candidate = buildEmojiUrl(cat, name, ext);
                                          if (e.currentTarget.src !== candidate) {
                                            e.currentTarget.src = candidate;
                                            return;
                                          }
                                        }
                                      }}
                                    />
                                  );
                                }
                                return <img {...props} />;
                              },
                              code: ({inline, className, children, ...props}) => {
                                const raw = String(children || '');
                                const text = raw.replace(/\\n/g, '\n');
                                if (inline) return <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800" {...props}>{text}</code>;
                                const m = /language-([\w-]+)/.exec(className || '');
                                const lang = m ? m[1] : null;
                                return <CodeBlock text={text} lang={lang} />;
                              },
                            }}
                            remarkPlugins={[remarkEmojiShortcode]}
                            rehypePlugins={[]}
                          >
                            {renderMarkdownText(inner)}
                          </ReactMarkdown>
                        </span>
                      );

                      pendingBreaks = trailingBreaks;
                      lastWasSpoiler = false;
                      return node;
                    })}
                  </React.Fragment>
                );
              })}
            </>
          );
        }
      })}
    </div>
  );
};

export default ContentRenderer;

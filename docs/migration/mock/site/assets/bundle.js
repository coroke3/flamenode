/* @ds-bundle: {"format":4,"namespace":"FlameNode","components":[{"name":"Button"},{"name":"TextField"},{"name":"Checkbox"},{"name":"Tabs"},{"name":"Status"},{"name":"ProgressBar"},{"name":"Row"},{"name":"VideoCard"},{"name":"Modal"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(" ");
  }

  /* Icons: a Font Awesome class string ("fa-solid fa-play") or any React node. */
  function icon(x) {
    if (!x) return null;
    if (typeof x === "string") return h("i", { className: "fn-icon " + x, "aria-hidden": "true" });
    return h("span", { className: "fn-icon", "aria-hidden": "true" }, x);
  }

  function omit(props, keys) {
    var rest = Object.assign({}, props);
    keys.forEach(function (k) { delete rest[k]; });
    /* x-import camelCases attributes: ariaLabel -> aria-label, ariaDescribedby -> aria-describedby */
    Object.keys(rest).forEach(function (k) {
      if (/^aria[A-Z]/.test(k)) { rest["aria-" + k.slice(4).toLowerCase()] = rest[k]; delete rest[k]; }
    });
    return rest;
  }

  function Button(props) {
    var variant = props.variant || "primary";
    var size = props.size || "md";
    var iconOnly = props.icon && (props.children == null || props.children === "");
    var rest = omit(props, ["variant", "size", "className", "children", "icon"]);
    return h("button", Object.assign({ type: "button" }, rest, {
      className: cx("fn-btn", "fn-btn--" + variant, size === "sm" && "fn-btn--sm", iconOnly && "fn-btn--icon", props.className)
    }), icon(props.icon), iconOnly ? null : props.children);
  }

  /* Status = icon + word. No dots, no pills. Only the icon is colored. */
  var STATUS = {
    public: ["fa-eye", "PUBLIC"], reserved: ["fa-clock", "RESERVED"], draft: ["fa-pen", "DRAFT"],
    warning: ["fa-triangle-exclamation", "WARNING"], error: ["fa-circle-xmark", "ERROR"], live: ["fa-tower-broadcast", "LIVE"]
  };
  function Status(props) {
    var status = STATUS[props.status] ? props.status : "draft";
    return h("span", { className: cx("fn-status", "fn-status--" + status, props.className) },
      icon("fa-solid " + STATUS[status][0]),
      h("span", null, props.label || STATUS[status][1]));
  }

  function TextField(props) {
    var reactId = React.useId();
    var id = props.id || reactId;
    var msgId = id + "-msg";
    var rest = omit(props, ["label", "hint", "error", "multiline", "className", "id", "icon"]);
    var control = h(props.multiline ? "textarea" : "input", Object.assign({
      id: id,
      className: "fn-field__control",
      "aria-invalid": props.error ? "true" : undefined,
      "aria-describedby": (props.error || props.hint) ? msgId : undefined,
      rows: props.multiline ? 4 : undefined,
      "aria-label": props.label ? undefined : (props.placeholder || undefined)
    }, rest));
    var msg = null;
    if (props.error) {
      msg = h("div", { id: msgId, className: "fn-field__msg fn-field__msg--error" },
        icon("fa-solid fa-circle-exclamation"),
        h("span", null, props.error));
    } else if (props.hint) {
      msg = h("div", { id: msgId, className: "fn-field__msg" }, props.hint);
    }
    return h("div", { className: cx("fn-field", props.icon && !props.multiline && "fn-field--icon", props.className) },
      props.label ? h("label", { className: "fn-field__label", htmlFor: id }, props.label) : null,
      h("div", { className: "fn-field__wrap" }, props.multiline ? null : icon(props.icon), control),
      msg);
  }

  function Checkbox(props) {
    var rest = omit(props, ["label", "className"]);
    return h("label", { className: cx("fn-cb", props.className) },
      h("input", Object.assign({ type: "checkbox" }, rest)),
      h("span", { className: "fn-cb__box", "aria-hidden": "true" },
        h("svg", { viewBox: "0 0 14 14", fill: "none", stroke: "var(--bg)", strokeWidth: 2, strokeLinecap: "butt" },
          h("path", { d: "M2 7.5 L5.5 11 L12 3" }))),
      props.label ? h("span", null, props.label) : null);
  }

  function Tabs(props) {
    var items = props.items || [];
    return h("div", { className: cx("fn-tabs", props.className), role: "tablist" },
      items.map(function (it) {
        return h("button", {
          key: it.id, type: "button", role: "tab", className: "fn-tab",
          "aria-selected": it.id === props.value ? "true" : "false",
          onClick: function () { if (props.onChange) props.onChange(it.id); }
        }, icon(it.icon), it.label);
      }));
  }

  function ProgressBar(props) {
    var v = Math.max(0, Math.min(1, props.value || 0));
    return h("div", {
      className: cx("fn-progress", props.className), role: "progressbar",
      "aria-label": props.label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(v * 100)
    }, h("div", { className: "fn-progress__fill", style: { width: (v * 100) + "%" } }));
  }

  function activate(props, attrs) {
    if (typeof props.onClick !== "function") return attrs;
    attrs.role = "button"; attrs.tabIndex = 0;
    attrs.onKeyDown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onClick(e); } };
    return attrs;
  }

  function Row(props) {
    var attrs = activate(props, {
      className: cx("fn-row", props.selected && "fn-row--selected", props.compact && "fn-row--compact", props.className),
      onClick: props.onClick,
      lang: props.lang || "ja"
    });
    if (props.selected) attrs["aria-current"] = "true";
    return h("div", attrs,
      props.thumbnail ? h("img", { className: "fn-row__thumb", src: props.thumbnail, alt: "" }) : null,
      h("div", { className: "fn-row__body" },
        h("p", { className: "fn-row__title" }, props.title),
        props.meta ? h("div", { className: "fn-row__meta" }, props.meta) : null),
      (props.status || props.trailing) ? h("div", { className: "fn-row__trail" },
        props.status ? h(Status, { status: props.status, label: props.statusLabel }) : null,
        props.trailing) : null);
  }

  function VideoCard(props) {
    var attrs = activate(props, { className: cx("fn-vc", props.className), onClick: props.onClick, lang: props.lang || "ja" });
    return h("div", attrs,
      h("div", { className: "fn-vc__thumb" },
        props.thumbnail ? h("img", { src: props.thumbnail, alt: "" }) : null),
      h("div", null,
        h("div", { className: "fn-vc__head" },
          h("p", { className: "fn-vc__title" }, props.title),
          props.duration ? h("span", { className: "fn-vc__dur" }, props.duration) : null),
        props.creator ? h("p", { className: "fn-vc__meta" },
          h("span", { className: "fn-vc__creator" },
            h("span", { className: "fn-vc__av" }, props.creatorIcon ? h("img", { src: props.creatorIcon, alt: "" }) : icon("fa-solid fa-user")),
            props.creator)) : null));
  }

  function Modal(props) {
    var titleId = React.useId();
    var onClose = props.onClose;
    React.useEffect(function () {
      if (!props.open || !onClose || props.contained) return undefined;
      function onKey(e) { if (e.key === "Escape") onClose(); }
      document.addEventListener("keydown", onKey);
      return function () { document.removeEventListener("keydown", onKey); };
    }, [props.open, onClose, props.contained]);
    if (!props.open) return null;
    return h("div", {
      lang: props.lang || "ja",
      className: cx("fn-modal-backdrop", props.contained && "fn-modal-backdrop--contained"),
      onClick: function (e) { if (e.target === e.currentTarget && onClose) onClose(); }
    }, h("div", { className: "fn-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
      h("div", { className: "fn-modal__content" },
        props.icon ? h("div", { className: "fn-modal__icon" }, icon(props.icon)) : null,
        h("h2", { id: titleId, className: "fn-modal__title" }, props.title),
        h("div", { className: "fn-modal__body" }, props.children)),
      props.actions ? h("div", { className: "fn-modal__actions" }, props.actions) : null));
  }

  window.FlameNode = {
    Button: Button, TextField: TextField, Checkbox: Checkbox, Tabs: Tabs, Status: Status,
    ProgressBar: ProgressBar, Row: Row, VideoCard: VideoCard, Modal: Modal
  };
})();

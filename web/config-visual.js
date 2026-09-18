'use strict';

(() => {
    const S = window.MockConfigSchema;
    const own = (value, key) => value != null && Object.hasOwn(value, key);
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const setKey = (target, key, value) => Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    let controlId = 0;
    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function button(text, action, className = 'button small') {
        const node = element('button', className, text);
        node.type = 'button';
        node.addEventListener('click', action);
        return node;
    }

    class ConfigVisualEditor {
        constructor(root, { onChange, onDirty, confirm }) {
            this.root = root;
            this.onChange = onChange;
            this.onDirty = onDirty;
            this.confirm = confirm;
            this.section = 'general';
            this.draft = {};
            this.openCards = new Set();
        }

        load(config, instance = {}) {
            this.draft = structuredClone(config);
            this.instance = instance;
            this.render();
        }

        read(path) { return path.reduce((node, key) => own(node, key) ? node[key] : undefined, this.draft); }

        write(path, value, render = false) {
            const parent = this.read(path.slice(0, -1));
            setKey(parent, path.at(-1), value);
            this.changed(render);
        }

        changed(render = false) {
            this.onChange(structuredClone(this.draft));
            if (render) this.render();
        }

        remove(path) {
            const parent = this.read(path.slice(0, -1));
            if (Array.isArray(parent)) parent.splice(path.at(-1), 1);
            else delete parent[path.at(-1)];
            this.changed(true);
        }

        checkInputs(excludedPath) {
            for (const input of this.root.querySelectorAll('input,select,textarea')) {
                const encodedPath = input.dataset.valuePath || input.dataset.keyPath;
                if (excludedPath && encodedPath) {
                    const path = JSON.parse(encodedPath);
                    if (excludedPath.every((key, i) => path[i] === key)) continue;
                }
                if (!input.checkValidity()) {
                    let parent = input.parentElement;
                    while (parent && parent !== this.root) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
                    input.reportValidity();
                    throw new Error('Correct the highlighted visual field before continuing.');
                }
            }
        }

        get() { this.checkInputs(); return structuredClone(this.draft); }

        canChangeStructure(excludedPath) {
            try { this.checkInputs(excludedPath); return true; } catch { return false; }
        }

        seed(schema) {
            if (schema.kind === 'reference') return Object.keys(this.draft[schema.target] || {})[0] || '';
            const result = structuredClone(schema.default ?? '');
            if (schema.kind === 'object' && object(result)) {
                for (const [key, field] of Object.entries(schema.fields)) if (field.required && !own(result, key)) setKey(result, key, this.seed(field));
            }
            return result;
        }

        card(title, path, open = false) {
            const details = element('details', 'visual-card');
            const id = JSON.stringify(path);
            details.dataset.card = id;
            details.open = this.openCards.has(id) || open;
            const summary = element('summary', '', title);
            details.append(summary);
            details.addEventListener('toggle', () => { if (details.open) this.openCards.add(id); else this.openCards.delete(id); });
            return details;
        }

        render() {
            // DOM controls are rebuilt only for structural edits, never on each keystroke.
            const scroll = this.root.scrollTop;
            const nav = element('div', 'visual-sections');
            nav.setAttribute('role', 'tablist');
            nav.setAttribute('aria-label', 'Configuration sections');
            for (const section of S.sections) {
                const tab = button(section.label, () => {
                    try { this.checkInputs(); } catch { return; }
                    this.section = section.id; this.render();
                }, 'visual-section-tab' + (section.id === this.section ? ' active' : ''));
                tab.dataset.section = section.id;
                tab.setAttribute('role', 'tab');
                tab.setAttribute('aria-selected', String(section.id === this.section));
                nav.append(tab);
            }
            const section = S.sections.find(item => item.id === this.section);
            const body = element('div', 'visual-section-body');
            body.setAttribute('role', 'tabpanel');
            body.setAttribute('aria-label', section.label);
            const heading = element('div', 'visual-section-heading');
            heading.append(element('h2', '', section.label), element('p', 'field-help', section.description));
            body.append(heading);
            if (section.id === 'general') body.append(element('p', 'visual-note', 'Host, port, and HTTPS changes require a restart. Download the draft to use these settings in your configuration file; other settings can be applied live.'));
            if (section.id === 'admin') body.append(element('p', 'visual-note', this.instance.tokenRequired ? 'This instance requires an admin token. Its value is kept on the server.' : 'This instance uses local access without an admin token.'));
            for (const key of section.keys) body.append(this.property(S.fields[key], [key]));
            if (section.id === 'general') {
                const unknown = Object.keys(this.draft).filter(key => !own(S.fields, key));
                for (const key of unknown) body.append(this.property(S.value(key, 'Unrecognized configuration option. It is preserved, but validation may reject it.'), [key]));
            }
            this.root.replaceChildren(nav, body);
            this.root.scrollTop = scroll;
        }

        property(schema, path) {
            const current = this.read(path);
            const present = current !== undefined;
            const wrapper = element('div', 'visual-property' + (present ? ' is-set' : ''));
            wrapper.dataset.field = JSON.stringify(path);
            const heading = element('div', 'visual-property-heading');
            const description = element('div');
            const title = element('span', 'visual-field-label', schema.label);
            description.append(title);
            if (schema.help) description.append(element('p', 'field-help', schema.help));
            heading.append(description);
            wrapper.append(heading);
            if (schema.locked) {
                wrapper.append(element('span', 'visual-default', 'Managed in the configuration file'));
                return wrapper;
            }
            if (!schema.required) {
                const label = element('label', 'visual-switch');
                const toggle = element('input'); toggle.type = 'checkbox'; toggle.checked = present;
                toggle.setAttribute('aria-label', 'Configure ' + schema.label);
                const parent = this.read(path.slice(0, -1));
                toggle.disabled = !present && schema.dependsOn && !own(parent, schema.dependsOn);
                toggle.addEventListener('change', async () => {
                    if (!this.canChangeStructure(toggle.checked ? undefined : path)) { toggle.checked = present; return; }
                    if (!toggle.checked) {
                        if (present && object(current) || Array.isArray(current)) {
                            if (!await this.confirm('Remove ' + schema.label.toLowerCase() + '?', 'This removes the configured values from your draft. You can discard the draft to restore the saved configuration.', 'Remove')) { toggle.checked = true; return; }
                        }
                        if (path.at(-1) === 'sequence') delete parent.sequenceMode;
                        this.remove(path);
                    } else {
                        const exclusive = (schema.exclusive || []).filter(key => own(parent, key));
                        if (exclusive.length && !await this.confirm('Replace the current behavior?', 'These options cannot be combined. Enabling ' + schema.label.toLowerCase() + ' removes ' + exclusive.join(', ') + ' from this draft.', 'Replace')) { toggle.checked = false; return; }
                        for (const key of exclusive) delete parent[key];
                        this.write(path, this.seed(schema), true);
                    }
                });
                label.append(toggle, element('span', '', present ? 'Configured' : 'Configure'));
                heading.append(label);
            }
            if (!present && !schema.required) {
                wrapper.append(element('span', 'visual-default', schema.dependsOn && !own(this.read(path.slice(0, -1)), schema.dependsOn) ? 'Enable ' + schema.dependsOn + ' first.' : 'Enable to configure this option. Omitted values keep their default or inherited behavior.'));
                return wrapper;
            }
            const editor = this.editor(schema, path);
            wrapper.append(editor);
            const control = editor.matches('input,select,textarea') ? editor : editor.querySelector('input,select,textarea');
            if (control) {
                control.id ||= 'visual-control-' + (++controlId);
                title.id = control.id + '-label';
                control.setAttribute('aria-labelledby', title.id);
            }
            return wrapper;
        }

        editor(schema, path) {
            const current = this.read(path);
            if (schema.kind === 'route') return this.editor(own(current, 'verb') ? schema.legacyEndpoint : schema.endpointMethods, path);
            if (schema.kind === 'value') return this.valueEditor(schema, path);
            if (schema.kind === 'union') return this.unionEditor(schema, path);
            if (['object', 'map'].includes(schema.kind) && !object(current) || ['array', 'tuple'].includes(schema.kind) && !Array.isArray(current)) {
                const wrapper = element('div', 'visual-mismatch');
                wrapper.append(element('p', 'field-help', 'This value has an unexpected type. It is preserved; choose “Use expected type” to replace it.'), this.valueEditor(S.value(schema.label), path), button('Use expected type', () => this.write(path, this.seed(schema), true)));
                return wrapper;
            }
            if (schema.kind === 'object') return this.objectEditor(schema, path);
            if (schema.kind === 'map') return this.mapEditor(schema, path);
            if (schema.kind === 'array') return this.arrayEditor(schema, path);
            if (schema.kind === 'tuple') {
                if (current.length !== schema.items.length) return this.valueEditor(S.value(schema.label), path);
                const row = element('div', 'visual-tuple');
                schema.items.forEach((item, i) => row.append(this.property({ ...item, required: true }, [...path, i])));
                return row;
            }
            return this.scalarEditor(schema, path);
        }

        scalarEditor(schema, path) {
            const current = this.read(path);
            const numeric = schema.kind === 'number';
            const dropdown = ['enum', 'boolean', 'reference'].includes(schema.kind);
            const input = element(dropdown ? 'select' : schema.multiline ? 'textarea' : 'input', 'visual-input');
            input.dataset.valuePath = JSON.stringify(path);
            if (dropdown) {
                const values = schema.kind === 'boolean' ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }]
                    : schema.kind === 'reference' ? Object.keys(this.draft[schema.target] || {}) : schema.options;
                const options = values.map(value => object(value) ? value : { value, label: String(value) });
                if (!options.some(option => String(option.value) === String(current))) options.unshift({ value: current ?? '', label: current === undefined || current === '' ? 'Choose a value…' : String(current) + ' (not in available options)' });
                for (const option of options) { const node = element('option', '', option.label); node.value = String(option.value); input.append(node); }
                input.value = String(current ?? '');
            } else {
                if (input.tagName === 'INPUT') input.type = numeric ? 'number' : 'text';
                input.value = current === undefined ? '' : String(current);
                if (numeric) {
                    input.step = schema.integer ? '1' : 'any';
                    input.required = true;
                    if (schema.min !== undefined) input.min = String(schema.min);
                    if (schema.max !== undefined) input.max = String(schema.max);
                }
                if (schema.multiline) input.rows = 3;
            }
            if (current !== undefined && (numeric && typeof current !== 'number' || schema.kind === 'string' && typeof current !== 'string' || schema.kind === 'boolean' && typeof current !== 'boolean')) {
                input.setCustomValidity('The draft has an unexpected value type. Edit this field to correct it.');
            }
            input.addEventListener(dropdown ? 'change' : 'input', () => {
                this.onDirty(); input.setCustomValidity('');
                if (!input.checkValidity()) return;
                const next = schema.kind === 'boolean' ? input.value === 'true' : numeric ? input.valueAsNumber : input.value;
                if (numeric && !Number.isFinite(next)) return;
                this.write(path, next);
            });
            const wrapper = element('div', 'visual-scalar'); wrapper.append(input);
            if (schema.kind === 'reference' && !own(this.draft[schema.target], current)) wrapper.append(element('p', 'field-help', 'Choose a configured ' + (schema.target === 'data' ? 'data source, or add one in the Data sources section.' : 'handler, or add one in the Handlers section.')));
            if (schema.suggestions) {
                const list = element('datalist'); list.id = 'visual-options-' + (++controlId);
                schema.suggestions.forEach(text => { const option = element('option'); option.value = text; list.append(option); });
                input.setAttribute('list', list.id); wrapper.append(list);
            }
            if (schema.templated && schema.kind === 'string') wrapper.append(this.templateControl(input, path));
            return wrapper;
        }

        templateControl(input, path) {
            const tools = element('details', 'visual-template');
            tools.append(element('summary', '', 'Insert a request value'));
            const row = element('div', 'visual-template-row');
            const source = element('select'); source.setAttribute('aria-label', 'Template source');
            for (const [value, text] of [['params', 'Path parameter'], ['query', 'Query parameter'], ['body', 'Request body field'], ['headers', 'Request header'], ['method', 'HTTP method'], ['path', 'Request path'], ['scenario.index', 'Sequence step index']]) {
                const option = element('option', '', text); option.value = value; source.append(option);
            }
            const key = element('input'); key.placeholder = 'Field name, e.g. id'; key.setAttribute('aria-label', 'Template field name');
            source.addEventListener('change', () => { key.hidden = ['method', 'path', 'scenario.index'].includes(source.value); });
            row.append(source, key, button('Insert', () => {
                if (!key.hidden && !key.value.trim()) { key.focus(); return; }
                const expression = '{{' + source.value + (key.hidden ? '' : '.' + key.value.trim()) + '}}';
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                input.value = input.value.slice(0, start) + expression + input.value.slice(end);
                this.write(path, input.value);
                input.focus();
            }));
            tools.append(row, element('p', 'field-help', 'A template used as the entire value preserves its type. Embedded templates are inserted as text.'));
            return tools;
        }

        unionEditor(schema, path) {
            const current = this.read(path);
            const index = schema.choices.findIndex(choice => own(choice, 'value') ? choice.value === current : this.accepts(choice.schema, current));
            const wrapper = element('div', 'visual-union');
            const select = element('select'); select.setAttribute('aria-label', schema.label + ' mode');
            if (index < 0) { const unknown = element('option', '', 'Custom value (preserved)'); unknown.value = '-1'; select.append(unknown); }
            schema.choices.forEach((choice, i) => { const option = element('option', '', choice.label); option.value = i; select.append(option); });
            select.value = String(index);
            select.addEventListener('change', async () => {
                if (!this.canChangeStructure(path)) { select.value = String(index); return; }
                if (select.value === '-1') return;
                if ((object(current) && Object.keys(current).length || Array.isArray(current) && current.length) && !await this.confirm('Change ' + schema.label.toLowerCase() + '?', 'Changing this mode replaces its current options in your draft.', 'Change mode')) { select.value = String(index); return; }
                const choice = schema.choices[Number(select.value)];
                this.write(path, own(choice, 'value') ? choice.value : this.seed(choice.schema), true);
            });
            wrapper.append(select);
            if (index < 0) wrapper.append(this.valueEditor(S.value(schema.label), path));
            else if (schema.choices[index].schema) wrapper.append(this.editor(schema.choices[index].schema, path));
            return wrapper;
        }

        accepts(schema, value) {
            return ['object', 'map'].includes(schema.kind) ? object(value) : ['array', 'tuple'].includes(schema.kind) ? Array.isArray(value)
                : ['enum', 'reference', 'string'].includes(schema.kind) ? typeof value === 'string' : typeof value === schema.kind;
        }

        objectEditor(schema, path) {
            const wrapper = element('div', 'visual-object');
            const fields = schema.fields;
            const grouped = new Set(Object.values(schema.groups || {}).flat());
            for (const [key, field] of Object.entries(fields)) if (!grouped.has(key)) wrapper.append(this.property(field, [...path, key]));
            for (const [name, keys] of Object.entries(schema.groups || {})) {
                const card = this.card(name, [...path, '$group', name], name === 'Response');
                const content = element('div', 'visual-card-content');
                keys.forEach(key => { grouped.add(key); content.append(this.property(fields[key], [...path, key])); });
                card.append(content); wrapper.append(card);
            }
            const extra = Object.keys(this.read(path)).filter(key => !own(fields, key));
            if (schema.additional || extra.length) {
                const heading = element('p', 'field-help', schema.additional ? 'Additional properties and extensions' : 'Unrecognized options (preserved until you edit or remove them)');
                wrapper.append(heading, this.mapEditor({ kind: 'map', label: 'Additional properties', item: schema.additional || S.value('Value'), name: 'property', omit: Object.keys(fields), addLabel: 'Add property' }, path));
            }
            return wrapper;
        }

        mapEditor(schema, path) {
            const wrapper = element('div', 'visual-map');
            const current = this.read(path);
            const keys = Object.keys(current).filter(key => !(schema.omit || []).includes(key));
            if (!keys.length) wrapper.append(element('p', 'visual-empty', 'No ' + schema.label.toLowerCase() + ' configured yet.'));
            keys.forEach(key => {
                const itemPath = [...path, key];
                const item = this.card(key || '(empty name)', itemPath);
                const content = element('div', 'visual-card-content');
                const row = element('div', 'visual-item-toolbar');
                const label = element('label', '', schema.keyLabel || 'Name');
                const name = element(schema.keyOptions ? 'select' : 'input');
                name.dataset.keyPath = JSON.stringify(itemPath);
                name.setAttribute('aria-label', schema.keyLabel || schema.label + ' name');
                if (schema.keyOptions) {
                    const options = [...new Set([key, ...schema.keyOptions])];
                    options.forEach(value => { const option = element('option', '', value.toUpperCase()); option.value = value; name.append(option); });
                }
                name.value = key;
                if (path.length === 1 && path[0] === 'endpoints') { name.pattern = '/[^?#\\\\\\s]*'; name.required = true; }
                name.addEventListener('input', () => { this.onDirty(); name.setCustomValidity(''); });
                name.addEventListener('change', () => {
                    const next = name.value;
                    if (next === key) return;
                    if (own(current, next) || schema.keyOptions && Object.keys(current).some(existing => existing.toLowerCase() === next.toLowerCase())) { name.setCustomValidity('This name is already in use.'); name.reportValidity(); return; }
                    if (!name.checkValidity()) return;
                    // Rebuild in place to retain declaration order and safe arbitrary keys.
                    const replacement = Object.fromEntries(Object.entries(current).map(([old, value]) => [old === key ? next : old, value]));
                    if (path.length === 1 && ['data', 'customHandlers'].includes(path[0])) this.renameReferences(path[0] === 'data' ? 'data' : 'handler', key, next);
                    this.openCards.add(JSON.stringify([...path, next]));
                    this.write(path, replacement, true);
                });
                label.append(name);
                row.append(label, button('Remove', async () => {
                    if (!this.canChangeStructure(itemPath)) return;
                    if (await this.confirm('Remove ' + key + '?', 'This removes the item from your draft. References must be updated before the draft can be applied.', 'Remove')) this.remove(itemPath);
                }, 'button small danger-text'));
                content.append(row, this.editor(schema.item, itemPath));
                item.append(content); wrapper.append(item);
            });
            wrapper.append(button(schema.addLabel || 'Add ' + schema.name, () => {
                try { this.checkInputs(); } catch { return; }
                let name = schema.keyOptions ? schema.keyOptions.find(key => !Object.keys(current).some(existing => existing.toLowerCase() === key)) : schema.name;
                if (name === undefined) return;
                if (!schema.keyOptions) { let index = 2; while (own(current, name)) name = schema.name + '-' + index++; }
                setKey(current, name, schema.itemDefault ? structuredClone(schema.itemDefault) : this.seed(schema.item));
                this.openCards.add(JSON.stringify([...path, name]));
                this.changed(true);
            }));
            return wrapper;
        }

        renameReferences(field, from, to) {
            const rename = definition => {
                if (definition[field] === from) definition[field] = to;
                for (const child of [...(definition.variants || []), ...(definition.sequence || [])]) if (child[field] === from) child[field] = to;
            };
            for (const endpoint of Object.values(this.draft.endpoints || {})) {
                if (!object(endpoint)) continue;
                if (own(endpoint, 'verb')) rename(endpoint);
                else Object.values(endpoint).filter(object).forEach(rename);
            }
        }

        arrayEditor(schema, path) {
            const current = this.read(path);
            const wrapper = element('div', 'visual-array');
            if (!current.length) wrapper.append(element('p', 'visual-empty', 'No items yet.'));
            current.forEach((_value, index) => {
                const item = this.card((schema.item.label || 'Item') + ' ' + (index + 1), [...path, index], true);
                const content = element('div', 'visual-card-content');
                const actions = element('div', 'visual-array-actions');
                const up = button('Move up', () => { if (!this.canChangeStructure()) return; [current[index - 1], current[index]] = [current[index], current[index - 1]]; this.changed(true); }); up.disabled = index === 0;
                const down = button('Move down', () => { if (!this.canChangeStructure()) return; [current[index + 1], current[index]] = [current[index], current[index + 1]]; this.changed(true); }); down.disabled = index === current.length - 1;
                actions.append(up, down, button('Remove', async () => { if (this.canChangeStructure([...path, index]) && await this.confirm('Remove this item?', 'The remaining items keep their order.', 'Remove')) this.remove([...path, index]); }, 'button small danger-text'));
                content.append(actions, this.editor(schema.item, [...path, index]));
                item.append(content); wrapper.append(item);
            });
            wrapper.append(button('Add item', () => { if (!this.canChangeStructure()) return; current.push(this.seed(schema.item)); this.changed(true); }));
            return wrapper;
        }

        valueEditor(schema, path) {
            const current = this.read(path);
            const type = kind(current);
            const types = schema.types || ['object', 'array', 'string', 'number', 'boolean', 'null'];
            const wrapper = element('div', 'visual-value');
            const toolbar = element('div', 'visual-value-toolbar');
            const select = element('select'); select.setAttribute('aria-label', schema.label + ' value type');
            for (const name of [...new Set([...(types.includes(type) ? [] : [type]), ...types])]) { const option = element('option', '', ({ object: 'Object · named properties', array: 'Array · list of values', string: 'Text', number: 'Number', boolean: 'Boolean', null: 'Null' })[name] || name); option.value = name; select.append(option); }
            select.value = type;
            select.addEventListener('change', async () => {
                if (!this.canChangeStructure(path)) { select.value = type; return; }
                if (object(current) && Object.keys(current).length || Array.isArray(current) && current.length) {
                    if (!await this.confirm('Change the value type?', 'The existing value will be replaced in this draft.', 'Change type')) { select.value = type; return; }
                }
                this.write(path, ({ object: {}, array: [], string: '', number: 0, boolean: false, null: null })[select.value], true);
            });
            toolbar.append(select); wrapper.append(toolbar);
            const child = S.value('Value', '', { default: '', templated: schema.templated });
            if (type === 'object') wrapper.append(this.mapEditor({ kind: 'map', label: 'Properties', item: child, name: 'property', addLabel: 'Add property', keyLabel: 'Property name' }, path));
            else if (type === 'array') wrapper.append(this.arrayEditor({ kind: 'array', item: child }, path));
            else if (type === 'null') wrapper.append(element('span', 'visual-default', 'The JSON value null.'));
            else wrapper.append(this.scalarEditor({ kind: type === 'string' ? 'string' : type, label: schema.label, multiline: type === 'string', templated: schema.templated }, path));
            return wrapper;
        }
    }

    window.ConfigVisualEditor = ConfigVisualEditor;
})();

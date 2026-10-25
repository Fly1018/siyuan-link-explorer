/*
 * Dialog helpers used by the plugin: a plain element dialog and a Svelte
 * component dialog. Both return a handle whose close() destroys the dialog.
 */
import { Dialog } from "siyuan";
import { Component, mount, unmount } from "svelte";

export const simpleDialog = (args: {
    title: string, ele: HTMLElement | DocumentFragment,
    width?: string, height?: string,
    callback?: () => void;
}) => {
    const dialog = new Dialog({
        title: args.title,
        content: `<div class="dialog-content" style="display: flex; height: 100%;"></div>`,
        width: args.width,
        height: args.height,
        destroyCallback: args.callback,
    });
    dialog.element.querySelector(".dialog-content")?.appendChild(args.ele);
    return {
        dialog,
        close: dialog.destroy.bind(dialog),
    };
};

export const svelteDialog = (args: {
    title: string,
    component: Component<any>,
    props?: Record<string, any>,
    width?: string,
    height?: string,
    callback?: () => void,
}) => {
    const container = document.createElement("div");
    container.style.display = "contents";

    const componentInstance = mount(args.component, {
        target: container,
        props: args.props || {},
    });

    const { dialog, close } = simpleDialog({
        ...args,
        ele: container,
        callback: () => {
            unmount(componentInstance);
            if (args.callback) args.callback();
        },
    });

    return {
        component: componentInstance,
        dialog,
        close,
    };
};

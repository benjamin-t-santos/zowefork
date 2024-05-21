/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

import { Then, When } from "@cucumber/cucumber";
import { paneDivForTree } from "../shared.steps";
import { TreeItem } from "wdio-vscode-service";

When(/the user has a (.*) profile in their (.*) tree/, async function (initialState: string, tree: string) {
    const isExpanded = initialState === "collapsed";
    this.tree = tree;
    this.treePane = await paneDivForTree(tree);
    const visibleItems = (await this.treePane.getVisibleItems()) as TreeItem[];
    this.profileNode = visibleItems.find(async (treeItem) => (await treeItem.isExpanded()) === isExpanded);
    await expect(this.profileNode).toBeDefined();
});

Then(/a user can (.*) a profile with a filter set/, async function (action: string) {
    if (action === "collapse") {
        await this.profileNode.collapse();
    } else {
        await this.profileNode.expand();
    }
});

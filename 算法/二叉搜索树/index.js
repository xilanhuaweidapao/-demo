class Node {
    constructor(key) {
        this.key = key;
        this.left = null;
        this.right = null;
    }
}


class BinarySearchTree {
    constructor(compareFn = defaultCompare) {
        this.compareFn = compareFn;
        this.root = null;
    }

    insert(key) {
        if (this.root === null) {
            this.root = new Node(key);
        } else {
            this.insertNode(this.root, key);
        }
    }

    insertNode(node, key) {
        if (this.compareFn(key, node.key) === this.compareFn.LESS_THAN) {
            if (node.left === null) {
                node.left = new Node(key);
            } else {
                this.insertNode(node.left, key);
            }
        } else {
            if (node.right === null) {
                node.right = new Node(key);
            } else {
                this.insertNode(node.right, key);
            }
        }
    }
    // 中序遍历是一种以上行顺序访问BST所有节点的遍历方式，也就是以从最小到最大的顺序访问所有节点。
    // 中序遍历的一种应用就是对树进行排序操作
}
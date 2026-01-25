// 思路
// 从数列中挑出一个元素，称为"基准"（pivot）。
// 重新排序数列，所有元素比基准值小的摆放在基准前面，所有元素比基准值大的摆在基准的后面（相同的数可以到任一边）。在这个分区结束之后，该基准就处于数列的中间位置。
// 判断第 k 个最小元素位于左侧还是右侧，然后对该侧进行递归。

function swap(arr, a, b) {
    if (a === b) {
        return;
    }
    var c = arr[a];
    arr[a] = arr[b];
    arr[b] = c;
}

function quickSelect(arr, start, end, k) {
    var n = end - start;

    if (n <= 1) {
        return arr[start];
    } else {
        var p = end - 1;

        var pivot = arr[p];

        let leftIndex = start;

        for (let i = 0; i < n - 1; i++) {
            let curVal = arr[start + i];
            if (curVal <= point) {
                swap(arr, leftIndex++, start + i);
            }
        }                                                                                                                                                                                                                                                                                                                                                                                                                                                                           

        swap(arr, leftIndex, p);

        if (leftIndex > k - 1) {
            return quickSelect(arr, start, leftIndex, k);
        } else if (leftIndex < k - 1) {
            return quickSelect(arr, leftIndex, end, k);
        } else {
            return arr[k - 1];
        }
    }


}
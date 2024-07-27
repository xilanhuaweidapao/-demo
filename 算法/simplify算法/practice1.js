
// points [ { x, y } ]
function simplyfy(points, tolerance, highQuality) {
    if (points.length < 2) {
        return;
    }
    points = highQuality ? points : basicSimplify(points, tolerance);
    const results = [points[0]];
}

function calcPointDistance(point, point2) {
    let disX = point.x - point2.x;
    let disY = point.y - point2.y;
    return Math.sqrt(disX * disX + disY * disY);
}

function findLongistDistance() {

}

function execute(points, left, right, tolerance, results) {

}

function basicSimplify(points, tolerance) {

}


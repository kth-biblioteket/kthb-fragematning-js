
// Man skulle ju kunna använda lodash e.d. i stället men ;-)

export function request (method, url, body, alertError = true) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        if (method === 'POST' || method === 'PUT')
            xhr.setRequestHeader('Content-type', 'application/json; charset=utf-8');
        xhr.onload = () => {
            if (xhr.status !== 200) {
                if (alertError)
                    alert('Ett okänt fel uppstod; kontakta Infra!')
                return reject(xhr);
            }
            resolve(xhr.responseText && JSON.parse(xhr.responseText), xhr);
        };
        if (body)
            xhr.send(JSON.stringify(body));
        else
            xhr.send();
    });
}

export function get () {
    return request('GET', ...arguments);
}

export function post () {
    return request('POST', ...arguments);
}

export function put () {
    return request('PUT', ...arguments);
}

export function del () {
    return request('DELETE', ...arguments);
}

export function toLocalizedDateString (date) {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString();
}

export function countBy (rows, column) {
    return rows.reduce((a, c) => (a[c[column]] = (a[c[column]] || 0) + 1, a), {});
}

export function groupBy (rows, ...columns) {
    const grouped = rows.reduce((acc, cur) => {
        const key = columns.map(col => cur[col]).join('');

        acc[key] = acc[key] || Object.fromEntries(columns.map(col => [col, cur[col]]));
        acc[key].rows = acc[key].rows || [];
        acc[key].rows.push(cur);
        acc[key].count = acc[key].rows.length;

        return acc;
    }, {});
    return Object.values(grouped);
}

export function percentage (part, whole, precision = 1) {
    return ((part * 100) / whole).toFixed(precision).toString().replace('.', ',');
}

export function createTable (rows, title, headers, callback) {
    const div = document.createElement('div');
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const thead = document.createElement('thead');

    div.innerHTML = `<h2>${title}</h2>`;

    table.appendChild(thead);
    table.appendChild(tbody);
    div.appendChild(table);

    thead.innerHTML = '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';

    rows = [...rows];
    const sum = rows.map(row => row.count)?.reduce((a, b) => a + b, 0);
    rows.push(null) // Sista raden

    rows.forEach(row => {
        const tr = document.createElement('tr');
        const cells = callback(row, sum, tr);
        if (cells) {
            cells.forEach(c => {
                const td = document.createElement('td');
                if (c instanceof Element)
                    td.appendChild(c);
                else
                    td.innerHTML = c;
                //tr.innerHTML = cells.map(c => `<td>${c}</td>`).join('');
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }
    });

    return div;
}

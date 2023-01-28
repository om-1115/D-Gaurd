import { Security } from './../models/security';
import { HelperService } from './../services/util/helper';
import { IUser } from './../interfaces/user.interface';
import { Web3Store } from './../services/web3-storage';
import performance from "perf_hooks";
import express from "express";
import MainServerCore from './core/server-core';
import { DBService } from "../services/dbservice";
import { UserService } from '../services/user.service';
import * as fs from 'fs';
import * as stream from 'stream';
import { UploadedFile } from 'express-fileupload';
import { Base64 } from 'js-base64';
import { Blob } from 'node:buffer';
import { StorageProvider } from '@arcana/storage';
export default class MainServerRoutes extends MainServerCore {

    setupRoute() {

        function send(res: express.Response, data, t0) {
            let pre = performance.performance.now() - t0;
            console.log(`-->Request for:'${res.req.path}', from client:'${res.req.ip}' took:${pre}ms`);
            if (!res.headersSent) {
                res.send(JSON.stringify({ performance: pre, success: true, data }))
            } else {
                res.write(JSON.stringify({ performance: pre, success: true, data }));
                res.end();
            }
        }

        function err(res: express.Response, message, t0, statuscode = 400) {
            // res.status(statuscode);
            let pre = performance.performance.now() - t0;
            console.log(`-->Request errored for:'${res.req.path}', from client:'${res.req.ip}' took:${pre}ms`);
            console.error(message);
            res.send(JSON.stringify({ data: {}, response_status: 400, message, performance: pre, success: false }))
        }

        //#region Admin Area
        this.app.get('/', async (req, res) => {
            let t0 = performance.performance.now();
            let data = {} as any;
            try {
                send(res, data, t0)
            } catch (error) {
                err(res, error, t0)
            }
        })
        this.app.get('/admin/test-db', async (req, res) => {
            let t0 = performance.performance.now();
            let data = {} as any;
            const db = new DBService();
            try {
                data.result = (await db.connect());
                send(res, data, t0)
            } catch (error) {
                err(res, error, t0)
            }
        })
        // process.env.APP_SECRET_KEY
        this.app.post('/admin/prepare-db/' + "secrete", async (req, res) => {
            let t0 = performance.performance.now();
            let data = {} as any;
            const db = new DBService();
            try {
                data.result = { ...(await db.PrepareDB("dassworddb")) };
                send(res, data, t0)
            } catch (error) {
                console.log(error);
                err(res, error, t0)
            }
        })
        //#endregion


        this.app.post('/register', async (req, res) => {
            let t0 = performance.performance.now();
            try {
                const userSrv = new UserService();
                let newUserObject: IUser = req.body.secureAuthObject;
                newUserObject.meta = {
                    private_key: HelperService.makeid(64)
                }
                userSrv.registerUser(newUserObject).then((d) => {
                    delete d.meta;
                    send(res, d, t0)
                }).catch(e => {
                    err(res, e, t0)
                })
            } catch (error) {
                err(res, error, t0)
            }
        })

        this.app.post('/login', async (req, res) => {
            let t0 = performance.performance.now();
            try {
                const userSrv = new UserService();
                let secureAuthObject: IUser = req.body.secureAuthObject;
                userSrv.authenticatUser(secureAuthObject).then((d) => {
                    delete d.meta;
                    send(res, d, t0)
                }).catch(e => {
                    err(res, e, t0)
                })
            } catch (error) {
                err(res, error, t0)
            }
        })

        this.app.get('/ipfs/list-all-files/' + "secret", async (req, res) => {
            let t0 = performance.performance.now();
            let data = {} as any;
            const web3 = new Web3Store();
            try {
                data = await web3.listUploads();
                send(res, data, t0)
            } catch (error) {
                err(res, error, t0)
            }
        })

        this.app.post('/ipfs/store/db/', async (req, res) => {
            let t0 = performance.performance.now();
            let data = {} as any;
            try {
                // authenticate user
                const userSrv = new UserService();
                const secureAuthObject = userSrv.parse_if_string(req.body.secureAuthObject);
                const user = await userSrv.authenticatUser(secureAuthObject)
                console.log(user);
                if (!req.body.encrypteddb) throw new Error("No Db file was attached");
                if (!user) throw new Error("No user found");

                const encrypteddb = req.body.encrypteddb;
                const usersPrivateKey = user.meta.private_key;
                const serverEncryptedDb = Security.encryptString(encrypteddb, usersPrivateKey)
                // convert encrypteddb string to file object
                const buffer = Buffer.from(serverEncryptedDb);
                const theStream = () => stream.Readable.from(buffer);

                let node_file: any = {
                    name: "encrypteddb",
                    stream: theStream
                }
                const web3 = new Web3Store();

                // upload to IPFS
                const cidString = await web3.storeFiles(node_file);
                user.db_cid = cidString;
                user.db_version = req.body.db_version;
                const newuser = await userSrv.update_db_user({ user_id: user.user_id }, user);
                send(res, newuser, t0)
            } catch (error) {
                err(res, error, t0)
            }
        });


        

        this.app.post('/ipfs/retrive/db/', async (req, res) => {
            let t0 = performance.performance.now();
            try {
                if (!req.body.secureAuthObject) throw new Error("User data was not attached");

                // authenticate user
                const userSrv = new UserService();
                const user = await userSrv.authenticatUser(req.body.secureAuthObject)

                const web3 = new Web3Store();
                const files = await web3.retrieveFiles(user.db_cid);
                const file = files[0];

                if (!file) throw new Error("Db file was not found");

                // the following conversion supports arabic characters, emojis and Chinese and asian character
                // File ==> ArrayBuffer ==> Base64 ==> String ==> Object

                // Conver file to ArrayBuffer
                let buffer = await file.arrayBuffer() as any;

                // Convert ArrayBuffer to Base64
                var blob_file = new Blob([buffer], { type: 'text/plain' });
                var serverEncryptedDb = await blob_file.text();

                // Decrypt the database to user decryption level
                const usersPrivateKey = user.meta.private_key;
                const base64_str = Security.decryptString(serverEncryptedDb, usersPrivateKey)

                // Conver Base64 to String
                let enctyptedStringfiedDBObject = Base64.decode(base64_str)

                // Converty String to Object
                let enctyptedDBObject = JSON.parse(enctyptedStringfiedDBObject);

                send(res, enctyptedDBObject, t0)

            } catch (error) {
                err(res, error, t0)
            }
        })

        this.app.post('/ipfs/store/file/', async (req, res) => {
            let t0 = performance.performance.now();
            let data = {} as any;
            try {
                // authenticate user
                const userSrv = new UserService();
                const secureAuthObject = userSrv.parse_if_string(req.body.secureAuthObject);
                const user = await userSrv.authenticatUser(secureAuthObject)
                if (!req.files?.encrypteddb?.['data']) throw new Error("No Db file was attached");

                const dbFile = req.files.encrypteddb as UploadedFile;
                if (!user) throw new Error("No user found");

                const buffer = Buffer.from(dbFile.data);
                const theStream = () => stream.Readable.from(buffer);

                let node_file: any = {
                    name: dbFile.name,
                    stream: theStream
                }
                const web3 = new Web3Store();
                const cidString = await web3.storeFiles(node_file);
                user.db_cid = cidString;
                user.db_version = req.body.db_version;
                const newuser = await userSrv.update_db_user({ user_id: user.user_id }, user);
                send(res, newuser, t0)
            } catch (error) {
                err(res, error, t0)
            }
        });


        this.app.get('/ipfs/retrive/file/', async (req, res) => {
            let t0 = performance.performance.now();
            console.log("hello")
            try {
                // if (!req.body.user_id) throw new Error("User data was not attached");
                // if ("e4c5933a-964a-4884-aad7-b1c6edb761b7") throw new Error("User data was not attached");


                // const user_id = req.body.user_id;
                // const fileCid = req.body.fileCid;
                const user_id = "e4c5933a-964a-4884-aad7-b1c6edb761b7";
                const fileCid = "bafkreigrajz5bnbz2fxggoyxeuftwe3hm3oa3752qugon4hfo4nrzrpqqa";
                // get user from db record
                const userSrv = new UserService();
                let user = await userSrv.get_db_user({ user_id });

                if (!user) throw new Error("No user found");

                const web3 = new Web3Store();
                const response = await web3.retrieve(fileCid);
                var files = await response.files();
                const file = files[0];
                console.log(file);

                //tell the browser to download this
                res.setHeader('Content-disposition', 'attachment; filename=' + file.name);
                res.setHeader('Content-type', file.type);
                
                //convert to a buffer and send to client
                let buffer = await file.arrayBuffer();
                console.log(buffer)
                console.log(JSON.stringify(buffer));
                res.status(200).send(buffer)

            } catch (error) {
                err(res, error, t0)
            }
        })


        this.app.get('/logout',(req,res)=>{
           
            res.redirect("/");
        })

        this.app.get("/ipfs/retrive/file/"+"bafkreigrajz5bnbz2fxggoyxeuftwe3hm3oa3752qugon4hfo4nrzrpqqa",(req,res)=>{
            let t0=performance.performance.now();
            var queryId=req.params.id;
            console.log(queryId);

        })
        this.app.get("/ipfs/ret/file/"+"bafkreigrajz5bnbz2fxggoyxeuftwe3hm3oa3752qugon4hfo4nrzrpqqa"+"/data/download",(req,res)=>{
            let t1=performance.performance.now();
            var queryId=req.params.id;
            const web3 = new Web3Store();
            const fileCid = "bafkreigrajz5bnbz2fxggoyxeuftwe3hm3oa3752qugon4hfo4nrzrpqqa";
                const response =  web3.retrieve(fileCid);

                console.log(response)
                console.log(web3)

        })


    }

}